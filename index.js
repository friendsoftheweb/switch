#!/usr/bin/env node

const { execSync } = require('child_process');
const chalk = require('chalk');

const branch = process.argv[2];

if (branch == null) {
  console.log(chalk.red('Please provide a branch name: switch NAME'));
  process.exit(1);
}

const modifiedFileCount = parseInt(
  execSync('git status --porcelain -- | wc -l | tr -d " "', {
    stdio: ['pipe', 'pipe', 'ignore']
  }).toString()
);

if (modifiedFileCount > 0) {
  console.log(
    chalk.red(
      'Please commit or stash all changes in your current branch first.'
    )
  );
  process.exit(1);
}

function diffLines(branch) {
  return execSync(`git diff ${branch} --name-status`)
    .toString()
    .split('\n')
    .reverse();
}

let yarnLockChanged = false;
let gemfileLockChanged = false;
const migrationVersions = [];

for (const line of diffLines(branch)) {
  if (/^M\s+yarn.lock/.test(line)) {
    yarnLockChanged = true;
  } else if (/^M\s+Gemfile.lock/.test(line)) {
    gemfileLockChanged = true;
  } else {
    const match = /^A\s+db\/migrate\/([0-9]+)/.exec(line);

    if (match != null) {
      migrationVersions.push(match[1]);
    }
  }
}

if (migrationVersions.length > 0) {
  console.log(
    chalk.blue(`\nReverting ${migrationVersions.length} migration(s)...`)
  );
}

for (const version of migrationVersions) {
  execSync(`VERSION=${version} bin/rake db:migrate:down`, {
    stdio: 'inherit'
  });
}

console.log(chalk.blue('\nSwitching branch...'));
execSync(`git reset --hard && git checkout ${branch}`);

if (yarnLockChanged) {
  console.log(chalk.blue('\nRunning yarn install...'));
  execSync('yarn install', { stdio: 'inherit' });
}

if (gemfileLockChanged) {
  console.log(chalk.blue('\nRunning bundle install and restarting server...'));
  execSync('bundle install', { stdio: 'inherit' });
  execSync('touch tmp/restart.txt');
}

console.log(chalk.blue('\nRunning migrations...'));

execSync(`bin/rake db:migrate`, {
  stdio: 'inherit'
});
