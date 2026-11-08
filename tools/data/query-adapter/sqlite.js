import { getDb } from '../../../runtime/store.js';

const IDENTIFIER_REGEX = /^[a-zA-Z0-9_]+$/;

function sanitizeIdentifier(name) {
  if (!name || typeof name !== 'string' || !IDENTIFIER_REGEX.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

export async function executeSQLiteQuery({
  operation = 'search',
  index,
  filter = {},
  fields = [],
  limit = 50,
  data = null
}, state = {}) {
  const db = getDb(state.dbPath);
  if (!index) throw new Error('Missing "index" (table name) parameter for SQLite query');
  const safeTable = sanitizeIdentifier(index);

  const selectedFields = Array.isArray(fields) && fields.length > 0
    ? fields.map(f => sanitizeIdentifier(f)).join(', ')
    : '*';

  // Helper to build WHERE clause
  const whereParts = [];
  const params = [];

  if (filter && typeof filter === 'object') {
    if (filter.field && filter.op) {
      // Structured filter: { field, op, value }
      const col = sanitizeIdentifier(filter.field);
      const op = filter.op;
      const val = filter.value;

      if (op === 'eq' || op === '=') {
        whereParts.push(`${col} = ?`);
        params.push(val);
      } else if (op === 'neq' || op === '!=') {
        whereParts.push(`${col} != ?`);
        params.push(val);
      } else if (op === 'gt' || op === '>') {
        whereParts.push(`${col} > ?`);
        params.push(val);
      } else if (op === 'lt' || op === '<') {
        whereParts.push(`${col} < ?`);
        params.push(val);
      } else if (op === 'like') {
        whereParts.push(`${col} LIKE ?`);
        params.push(val);
      } else if (op === 'in' && Array.isArray(val)) {
        whereParts.push(`${col} IN (${val.map(() => '?').join(',')})`);
        params.push(...val);
      }
    } else {
      // Key-value map filter: { key1: val1, key2: val2 }
      for (const [col, val] of Object.entries(filter)) {
        whereParts.push(`${sanitizeIdentifier(col)} = ?`);
        params.push(val);
      }
    }
  }

  const whereClause = whereParts.length > 0 ? ` WHERE ${whereParts.join(' AND ')}` : '';

  switch (operation) {
    case 'search':
    case 'get': {
      const sql = `SELECT ${selectedFields} FROM ${safeTable}${whereClause} LIMIT ?`;
      params.push(limit);
      const rows = db.prepare(sql).all(...params);
      return { rows, total: rows.length };
    }

    case 'insert': {
      if (!data || typeof data !== 'object') {
        throw new Error('Insert operation requires "data" object');
      }
      const rawCols = Object.keys(data);
      const safeCols = rawCols.map(c => sanitizeIdentifier(c));
      const vals = Object.values(data);
      const placeholders = safeCols.map(() => '?').join(', ');
      const sql = `INSERT INTO ${safeTable} (${safeCols.join(', ')}) VALUES (${placeholders})`;
      const info = db.prepare(sql).run(...vals);
      return { rows: [{ lastInsertRowid: info.lastInsertRowid }], total: info.changes };
    }

    case 'update': {
      if (!data || typeof data !== 'object') {
        throw new Error('Update operation requires "data" object');
      }
      const setParts = [];
      const setVals = [];
      for (const [col, val] of Object.entries(data)) {
        setParts.push(`${sanitizeIdentifier(col)} = ?`);
        setVals.push(val);
      }
      const sql = `UPDATE ${safeTable} SET ${setParts.join(', ')}${whereClause}`;
      const info = db.prepare(sql).run(...setVals, ...params);
      return { rows: [], total: info.changes };
    }

    case 'delete': {
      const sql = `DELETE FROM ${safeTable}${whereClause}`;
      const info = db.prepare(sql).run(...params);
      return { rows: [], total: info.changes };
    }

    default:
      throw new Error(`Unsupported SQLite operation: ${operation}`);
  }
}

export default { executeSQLiteQuery };
