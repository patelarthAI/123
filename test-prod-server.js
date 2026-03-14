import { spawn } from 'child_process';
import http from 'http';

const startServer = () => {
  return new Promise((resolve, reject) => {
    const server = spawn('npm', ['run', 'start'], {
      env: { ...process.env, NODE_ENV: 'production', PORT: '3001' }
    });

    server.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
      if (data.toString().includes('Server running')) {
        resolve(server);
      }
    });

    server.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
    });

    server.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
      reject(new Error(`Server exited with code ${code}`));
    });
  });
};

const test = async () => {
  try {
    const server = await startServer();
    console.log('Server started successfully in production mode.');
    server.kill();
  } catch (e) {
    console.error(e);
  }
};

test();
