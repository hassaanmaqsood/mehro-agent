const blessed = require('blessed');
const contrib = require('blessed-contrib');

class MehroLocalAgentTUI {
    constructor() {
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'Mehro Agent - Local',
            fullUnicode: true,
            dockBorders: true
        });

        this.state = {
            activeModel: '',
            provider: '',
            tasks: [],
            selectedTaskIndex: 0,
            isWorking: false,
            spinnerFrame: 0,
            spinnerChars: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
            callbacks: {}
        };

        this.initLayout();
        this.setupKeybindings();
        this.startSpinner();
        this.updateUI();
    }

    initLayout() {
        const isSmall = this.screen.width < 80;
        this.screen.children.slice().forEach(child => child.detach());
        this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });

        // 1. Header
        this.header = this.grid.set(0, 0, 1, 12, blessed.box, {
            content: this.getHeaderContent(),
            tags: true,
            style: { fg: 'white', bg: '#111' },
            border: { type: 'line', fg: '#333' }
        });

        // 2. Sidebar (History)
        const leftWidth = isSmall ? 0 : 3;
        const rightStart = leftWidth;
        const rightWidth = 12 - leftWidth;

        if (!isSmall) {
            this.chatHistory = this.grid.set(1, 0, 10, leftWidth, blessed.list, {
                label: ' History ',
                tags: true,
                keys: true,
                vi: true,
                mouse: true,
                scrollbar: { ch: ' ', track: { bg: 'cyan' } },
                border: { type: 'line', fg: 'cyan' },
                style: { selected: { bg: 'blue' } }
            });
        } else {
            this.chatHistory = null;
        }

        // 3. Main View (Expanded)
        this.detailsView = this.grid.set(1, rightStart, 10, rightWidth, blessed.box, {
            label: ' Task Information ',
            tags: true,
            keys: true,
            vi: true,
            mouse: true,
            scrollable: true,
            alwaysScroll: true,
            wrap: true,
            scrollbar: { ch: ' ', track: { bg: 'yellow' } },
            border: { type: 'line', fg: 'yellow' },
            style: { focus: { border: { fg: 'green' } } }
        });

        // Scroll controls
        this.detailsView.key(['up', 'k'], () => { this.detailsView.scroll(-1); this.screen.render(); });
        this.detailsView.key(['down', 'j'], () => { this.detailsView.scroll(1); this.screen.render(); });

        // 4. Footer
        this.footer = this.grid.set(11, 0, 1, 12, blessed.box, {
            content: ' {bold}[T]{/bold} Add | {bold}[Enter]{/bold} Run Task | {bold}[Tab]{/bold} Focus | {bold}[D]{/bold} Delete | {bold}[Q]{/bold} Quit ',
            tags: true,
            style: { fg: 'white', bg: '#222' }
        });

        this.focusableElements = [this.chatHistory, this.detailsView].filter(Boolean);
        this.currentFocusIndex = 0;

        if (this.chatHistory) {
            this.chatHistory.on('focus', () => { this.chatHistory.style.border.fg = 'green'; this.screen.render(); });
            this.chatHistory.on('blur', () => { this.chatHistory.style.border.fg = 'cyan'; this.screen.render(); });
            this.chatHistory.on('select item', () => {
                this.state.selectedTaskIndex = this.chatHistory.selected;
                this.updateDetails();
            });
        }

        this.detailsView.on('focus', () => { this.detailsView.style.border.fg = 'green'; this.screen.render(); });
        this.detailsView.on('blur', () => { this.detailsView.style.border.fg = 'yellow'; this.screen.render(); });

        this.screen.render();
    }

    getHeaderContent() {
        const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
        const spinner = this.state.isWorking ? `{yellow-fg}${this.state.spinnerChars[this.state.spinnerFrame]}{/yellow-fg} ` : '';
        return ` ${spinner}{bold}MEHRO AGENT{/bold} | ${this.state.activeModel} | ISB:${timeStr}`;
    }

    setupKeybindings() {
        this.screen.key(['q', 'C-c'], () => {
            if (this.state.callbacks.quit) this.state.callbacks.quit();
            else process.exit(0);
        });

        this.screen.key(['tab'], () => {
            if (this.focusableElements.length === 0) return;
            this.currentFocusIndex = (this.currentFocusIndex + 1) % this.focusableElements.length;
            this.focusableElements[this.currentFocusIndex].focus();
            this.screen.render();
        });

        this.screen.key(['t'], () => this.showAddTaskModal());
        
        this.screen.key(['d'], () => {
            const task = this.state.tasks[this.state.selectedTaskIndex];
            if (task && this.state.callbacks.deleteTask) {
                this.state.callbacks.deleteTask(task.id);
            }
        });

        this.screen.key(['enter'], () => {
             const task = this.state.tasks[this.state.selectedTaskIndex];
             if (task && task.status === 'pending' && this.state.callbacks.runTask) {
                 this.state.callbacks.runTask(task.id);
             }
        });

        this.screen.on('resize', () => {
            this.initLayout();
            this.updateUI();
        });
    }

    startSpinner() {
        setInterval(() => {
            if (this.state.isWorking) {
                this.state.spinnerFrame = (this.state.spinnerFrame + 1) % this.state.spinnerChars.length;
                this.header.setContent(this.getHeaderContent());
                this.screen.render();
            }
        }, 80);
    }

    on(event, callback) {
        this.state.callbacks[event] = callback;
    }

    updateState(newState) {
        this.state = { ...this.state, ...newState };
        this.updateUI();
    }

    updateUI() {
        this.updateChatList();
        this.updateDetails();
        this.header.setContent(this.getHeaderContent());
        this.screen.render();
    }

    updateChatList() {
        if (!this.chatHistory) return;
        const items = this.state.tasks.map(t => {
            const icon = t.status === 'success' ? '{green-fg}✔{/green-fg}' :
                        t.status === 'run' || t.status === 'ongoing' ? '{yellow-fg}●{/yellow-fg}' :
                        t.status === 'failed' ? '{red-fg}✘{/red-fg}' : '{white-fg}○{/white-fg}';
            return `${icon} ${t.userPrompt.substring(0, 15)}...`;
        });
        this.chatHistory.setItems(items);
        if (items.length > 0) this.chatHistory.select(this.state.selectedTaskIndex);
    }

    updateDetails() {
        const task = this.state.tasks[this.state.selectedTaskIndex];
        if (!task) {
            this.detailsView.setContent('{grey-fg}No task selected.{/grey-fg}');
            return;
        }

        // Save current scroll position
        const scrollPos = this.detailsView.childBase;

        let content = `{blue-fg}{underline}Task #${task.id} (${task.status.toUpperCase()}){/underline}{/blue-fg}\n`;
        content += `${task.userPrompt}\n\n`;
        
        content += `{yellow-fg}Execution Plan (DAG):{/yellow-fg}\n`;
        const dag = task.dag || [];
        if (dag.length === 0) {
            content += '{grey-fg}No plan generated yet.{/grey-fg}\n';
        } else {
            dag.forEach(node => {
                const color = node.status === 'success' ? '{green-fg}✔' :
                            node.status === 'ongoing' ? '{yellow-fg}●' :
                            node.status === 'error' ? '{red-fg}✘' : '{white-fg}○';
                content += `  ${color} [${node.id}] ${node.function}{/}\n`;
            });
        }

        content += `\n{yellow-fg}Progress Logs:{/yellow-fg}\n`;
        content += task.thoughtProcess || 'No logs yet.';
        
        if (task.output) {
            content += `\n\n{green-fg}Final Output:{/green-fg}\n${task.output}`;
        }

        this.detailsView.setContent(content);
        
        // Restore scroll position
        this.detailsView.childBase = scrollPos;
        this.detailsView.scrollTo(scrollPos);
    }

    showAddTaskModal() {
        const modal = blessed.box({
            parent: this.screen, top: 'center', left: 'center', width: '60%', height: 10,
            label: ' New Task ', border: { type: 'line', fg: 'green' }, style: { bg: '#000' }
        });
        const input = blessed.textbox({
            parent: modal, top: 4, left: 2, right: 2, height: 3,
            border: { type: 'line', fg: 'white' }, inputOnFocus: true
        });
        input.focus();
        this.screen.render();
        input.on('submit', (value) => {
            if (value && this.state.callbacks.addTask) this.state.callbacks.addTask(value);
            modal.detach();
            this.screen.render();
        });
        modal.key('escape', () => { modal.detach(); this.screen.render(); });
    }

    logTask(taskId, msg) {
        const targetTask = taskId ? this.state.tasks.find(t => t.id === taskId) : this.state.tasks[this.state.selectedTaskIndex];
        if (targetTask) {
            const time = new Date().toLocaleTimeString('en-US', { hour12: false });
            targetTask.thoughtProcess = (targetTask.thoughtProcess || '') + `\n{grey-fg}[${time}]{/grey-fg} ${msg}`;
            const currentSelected = this.state.tasks[this.state.selectedTaskIndex];
            if (currentSelected && currentSelected.id === targetTask.id) {
                this.updateDetails();
            }
            this.screen.render();
        }
    }
}

module.exports = new MehroLocalAgentTUI();
