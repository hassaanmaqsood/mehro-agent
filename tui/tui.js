import blessed from 'blessed';
import contrib from 'blessed-contrib';
import logger from '../src/logger.js';
import { resolveCommand } from '../runtime/commands.js';
import { auditRepo } from '../runtime/store.js';

export class MehroTUI {
  constructor(options = {}) {
    this.options = options;
    this.approvalMode = options.approvalMode || 'auto';
    this.headless = options.headless ?? (!process.stdout.isTTY);
    this.tasks = options.tasks || [];
    this.selectedTaskIndex = 0;
    this.isWorking = false;
    this.logListener = null;
    this.taskListener = null;

    if (!this.headless) {
      logger.setConsoleOutput(false);
      this.initScreen();
      this.initLayout();
      this.setupKeybindings();
    }

    this.bindLogger();
  }

  bindLogger() {
    this.logListener = (entry) => {
      this.onLogEntry(entry);
    };
    this.taskListener = (taskEvent) => {
      this.onTaskEvent(taskEvent);
    };

    logger.on('entry', this.logListener);
    logger.on('task', this.taskListener);

    // Replay any recent logs recorded before TUI initialized
    if (!this.headless && this.detailsView) {
      const recent = logger.getLogs(0);
      if (recent && recent.entries) {
        for (const entry of recent.entries) {
          this.onLogEntry(entry);
        }
      }
    }
  }

  initScreen() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Mehro Agent v2 - Local Orchestration Runtime',
      fullUnicode: true,
      dockBorders: true
    });
  }

  initLayout() {
    this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

    // Header
    this.header = this.grid.set(0, 0, 1, 12, blessed.box, {
      content: ' {bold}MEHRO AGENT v2{/bold} | Local Runtime',
      tags: true,
      style: { fg: 'white', bg: '#111' },
      border: { type: 'line', fg: '#333' }
    });

    // Sidebar: Tasks History
    this.historyList = this.grid.set(1, 0, 10, 3, blessed.list, {
      label: ' Tasks ',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: { ch: ' ', track: { bg: 'cyan' } },
      border: { type: 'line', fg: 'cyan' },
      style: { selected: { bg: 'blue' } }
    });

    // Main View: Logs & Task Details
    this.detailsView = this.grid.set(1, 3, 10, 9, blessed.box, {
      label: ' Logs & Plan ',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: { ch: ' ', track: { bg: 'yellow' } },
      border: { type: 'line', fg: 'yellow' }
    });

    // Footer
    this.footer = this.grid.set(11, 0, 1, 12, blessed.box, {
      content: ' {bold}[T]{/bold} Run Command/Slash | {bold}[A]{/bold} Approval Mode | {bold}[Q]{/bold} Quit ',
      tags: true,
      style: { fg: 'white', bg: '#222' }
    });

    this.screen.render();
  }

  setupKeybindings() {
    this.screen.key(['q', 'C-c'], () => {
      this.destroy();
      process.exit(0);
    });

    this.screen.key(['t'], () => {
      this.showCommandInput();
    });
  }

  onLogEntry(entry) {
    if (this.headless || !this.detailsView) return;
    const formatted = `{grey-fg}[${entry.ts.slice(11, 19)}]{/grey-fg} [${entry.level.toUpperCase()}] ${entry.message}\n`;
    this.detailsView.setContent((this.detailsView.getContent() || '') + formatted);
    this.detailsView.scrollTo(this.detailsView.getScrollHeight());
    this.screen.render();
  }

  onTaskEvent(taskEvent) {
    if (this.headless) return;
    this.onLogEntry({
      ts: taskEvent.ts,
      level: 'task',
      message: `Task ${taskEvent.taskId}: ${taskEvent.message}`
    });
  }

  showCommandInput() {
    if (this.headless) return;

    const modal = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 8,
      label: ' Enter Prompt or Slash Command (/run, /task, /standup) ',
      border: { type: 'line', fg: 'green' },
      style: { bg: '#000' }
    });

    const input = blessed.textbox({
      parent: modal,
      top: 2,
      left: 2,
      right: 2,
      height: 3,
      border: { type: 'line', fg: 'white' },
      inputOnFocus: true
    });

    input.focus();
    this.screen.render();

    input.on('submit', async (val) => {
      modal.detach();
      this.screen.render();
      if (val && val.trim()) {
        const res = await this.handleCommand(val.trim());
        logger.info(`Command executed: ${val.trim()}`, { result: res });
      }
    });

    modal.key('escape', () => {
      modal.detach();
      this.screen.render();
    });
  }

  async handleCommand(commandLine) {
    return resolveCommand(commandLine, {
      sessionApprovalMode: this.approvalMode,
      tuiConfirm: (opts) => this.confirm(opts)
    });
  }

  // Confirmation box in review mode: [Y] Approve, [N] Reject, [E] Edit, [A] All
  async confirm({ tool, input, stepInfo = '' }) {
    if (this.approvalMode === 'allow-all') {
      return { action: 'yes', approved: true, input };
    }

    if (this.headless) {
      // In headless test mode, inspect mock simulated action if set
      if (this.options.mockConfirmationAction) {
        return this._handleDecision(this.options.mockConfirmationAction, tool, input);
      }
      return { action: 'yes', approved: true, input };
    }

    return new Promise((resolve) => {
      const boxContent =
        `Tool:    ${tool}\n` +
        `Input:   ${JSON.stringify(input, null, 2)}\n` +
        (stepInfo ? `Step:    ${stepInfo}\n` : '') +
        `---------------------------------------------------\n` +
        `[Y] Approve   [N] Reject   [E] Edit   [A] All`;

      const confirmModal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '60%',
        height: 14,
        label: ' Tool Confirmation Required ',
        content: boxContent,
        border: { type: 'line', fg: 'yellow' },
        style: { bg: '#000', fg: 'white' }
      });

      this.screen.render();

      const handleKey = (ch, key) => {
        const keyName = (key.name || ch || '').toLowerCase();
        if (keyName === 'y') {
          cleanup();
          resolve(this._handleDecision('yes', tool, input));
        } else if (keyName === 'n') {
          cleanup();
          resolve(this._handleDecision('no', tool, input));
        } else if (keyName === 'a') {
          cleanup();
          this.approvalMode = 'allow-all';
          resolve(this._handleDecision('all', tool, input));
        } else if (keyName === 'e') {
          cleanup();
          // Edit mode
          this.showEditModal(tool, input, resolve);
        }
      };

      const cleanup = () => {
        this.screen.unkey(['y', 'n', 'a', 'e'], handleKey);
        confirmModal.detach();
        this.screen.render();
      };

      this.screen.key(['y', 'n', 'a', 'e'], handleKey);
    });
  }

  _handleDecision(action, tool, input, edited = null) {
    if (action === 'edit' && edited) {
      // Audit log when [E] Edit is used: log both original and edited input
      auditRepo.log({
        toolId: tool,
        input: { original: input, edited },
        status: 'edited_and_approved',
        metadata: { action: 'edit', approved: true }
      });
      return { action: 'edit', approved: true, input: edited, edited, original: input };
    }

    if (action === 'all') {
      this.approvalMode = 'allow-all';
      return { action: 'all', approved: true, input, mode: 'allow-all' };
    }

    if (action === 'no' || action === 'reject') {
      return { action: 'no', approved: false, input };
    }

    return { action: 'yes', approved: true, input };
  }

  showEditModal(tool, originalInput, resolve) {
    const editModal = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '65%',
      height: 10,
      label: ' Edit Input Before Approving ',
      border: { type: 'line', fg: 'cyan' }
    });

    const editInput = blessed.textbox({
      parent: editModal,
      top: 2,
      left: 2,
      right: 2,
      height: 3,
      value: typeof originalInput === 'object' ? JSON.stringify(originalInput) : String(originalInput),
      border: { type: 'line', fg: 'white' },
      inputOnFocus: true
    });

    editInput.focus();
    this.screen.render();

    editInput.on('submit', (val) => {
      editModal.detach();
      this.screen.render();
      let parsed = val;
      try {
        parsed = JSON.parse(val);
      } catch {
        // use raw string
      }
      resolve(this._handleDecision('edit', tool, originalInput, parsed));
    });
  }

  destroy() {
    if (this.logListener) {
      logger.removeListener('entry', this.logListener);
    }
    if (this.taskListener) {
      logger.removeListener('task', this.taskListener);
    }
    if (this.screen) {
      this.screen.destroy();
    }
    logger.setConsoleOutput(true);
  }
}

export default MehroTUI;
