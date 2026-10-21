// Emit the release image/version/tag for the target named by TARGET.
import { readFile } from 'node:fs/promises';

const target = process.env.TARGET;
if (!['web', 'tavern'].includes(target)) throw new Error('TARGET must be web or tavern');
const versions = JSON.parse(await readFile(new URL('../versions.json', import.meta.url), 'utf8'));
const version = target === 'web' ? versions.dsh.version : versions.tavern.version;
console.log(`image=${versions.registry}/${versions.release[target].image}`);
console.log(`version=${version}`);
console.log(`tag=${versions.release[target].tag}`);
