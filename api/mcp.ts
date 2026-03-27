import { createServer } from '../src/mcp-server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export default async function handler(req: any, res: any) {
  // Only POST is used for Streamable HTTP MCP
  if (req.method === 'GET') {
    // Health check / info endpoint
    res.status(200).json({
      name: 'kammaren-tax-engine',
      protocol: 'MCP',
      transport: 'streamable-http',
      docs: 'https://github.com/Baltsar/kammaren-tax-engine'
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null
    });
    return;
  }

  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined  // stateless, no sessions
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP handler error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      });
    }
  }
}
