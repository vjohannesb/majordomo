import { think, formatResponse, setDebug } from './src/core/brain.js';
import { executeTool, AVAILABLE_TOOLS } from './src/core/tools.js';

// Enable debug if DEBUG env var is set
if (process.env.DEBUG === '1') {
  setDebug(true);
}

async function test() {
  const query = process.argv[2] || 'list my slack channels';
  console.log(`Testing: "${query}"\n`);

  const response = await think(query, AVAILABLE_TOOLS);
  console.log('Routing:', response.message);
  console.log('Tools:', response.toolCalls.map(c => c.tool).join(', ') || '(none)');
  console.log('Confirmation:', response.requiresConfirmation);

  if (response.toolCalls.length > 0) {
    console.log('\nExecuting tools...');
    const toolResults: Array<{ tool: string; result: string }> = [];
    for (const call of response.toolCalls) {
      const result = await executeTool(call);
      console.log(`[${call.tool}] ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`);
      toolResults.push({ tool: call.tool, result });
    }

    console.log('\nFormatting response...');
    const formatted = await formatResponse(query, toolResults);
    console.log('\n--- Final Response ---');
    console.log(formatted);
  }
}

test().catch(console.error);
