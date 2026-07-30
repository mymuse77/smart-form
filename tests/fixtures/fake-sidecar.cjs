const readline = require('node:readline');

function send(message) {
  process.stdout.write(`${JSON.stringify({ protocol_version: '1.0.0', payload: {}, ...message })}\n`);
}

send({ type: 'ready', status: 'ready' });
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.type === 'execute') {
    send({
      type: 'ack',
      request_id: request.request_id,
      task_id: request.task_id,
      status: 'accepted',
    });
    setTimeout(() => send({
      type: 'result',
      request_id: request.request_id,
      task_id: request.task_id,
      status: 'succeeded',
      payload: { final_result: 'done' },
    }), 10);
  } else {
    send({
      type: 'ack',
      request_id: request.request_id,
      task_id: request.task_id,
      status: request.type,
    });
    if (request.type === 'shutdown') {
      lines.close();
      setTimeout(() => process.exit(0), 5);
    }
  }
});

