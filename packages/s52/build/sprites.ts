import child_process from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(child_process.exec);

export default {
  name: 'build-sprites',
  async buildStart() {
    console.log('Building sprites...');
    await exec('bin/build-sprites');
  }
}
