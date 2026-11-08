export async function executeElasticsearchQuery({
  operation = 'search',
  index,
  filter = {},
  fields = [],
  limit = 50,
  data = null
}, state = {}) {
  const backendUrl = state.backendUrl || process.env.ES_URL || 'http://localhost:9200';
  const apiKey = state.apiKey || process.env.ES_API_KEY;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `ApiKey ${apiKey}`;
  }

  if (operation === 'search' || operation === 'get') {
    const esQuery = {
      size: limit,
      query: { bool: { must: [] } }
    };

    if (fields.length > 0) {
      esQuery._source = fields;
    }

    if (filter.field && filter.op) {
      if (filter.op === 'eq' || filter.op === '=') {
        esQuery.query.bool.must.push({ term: { [filter.field]: filter.value } });
      } else if (filter.op === 'contains' || filter.op === 'like') {
        esQuery.query.bool.must.push({ match: { [filter.field]: filter.value } });
      }
    } else if (filter && Object.keys(filter).length > 0) {
      for (const [k, v] of Object.entries(filter)) {
        esQuery.query.bool.must.push({ term: { [k]: v } });
      }
    } else {
      esQuery.query = { match_all: {} };
    }

    try {
      const res = await fetch(`${backendUrl}/${index}/_search`, {
        method: 'POST',
        headers,
        body: JSON.stringify(esQuery),
        signal: state.signal
      });

      if (!res.ok) {
        throw new Error(`ES returned status ${res.status}`);
      }

      const body = await res.json();
      const hits = body.hits?.hits?.map(h => ({ _id: h._id, ...h._source })) || [];
      return { rows: hits, total: body.hits?.total?.value ?? hits.length };
    } catch (err) {
      // Return structured response or error
      return { rows: [], total: 0, error: err.message };
    }
  }

  return { rows: [], total: 0, error: `Operation '${operation}' not implemented for Elasticsearch adapter` };
}

export default { executeElasticsearchQuery };
