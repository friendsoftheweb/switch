#!/usr/bin/env node

const { execSync } = require('child_process');
const chalk = require('chalk');
const prompts = require('prompts');

function diffLines(branchName) {
  return execSync(`git diff ${branchName} --name-status`)
    .toString()
    .split('\n')
    .reverse();
}

function currentBranchHasRemote() {
  return !/^fatal:/.test(
    execSync('git rev-parse --abbrev-ref HEAD@{upstream}').toString()
  );
}

function logStepDescription(description) {
  console.log(chalk.blue(`\n---> ${description}`));
}

async function switchToBranch(branch) {
  if (branch == null) {
    const currentBranchName = execSync("git branch | grep \\* | cut -d ' ' -f2")
      .toString()
      .replace(/\s+$/, '');

    const otherBranchNames = execSync(
      "git branch | awk -F ' +' '! /(no branch)/ {print $2}'"
    )
      .toString()
      .replace(/\s+$/, '')
      .split(/\s+/)
      .filter(name => name !== currentBranchName);

    if (otherBranchNames.length === 0) {
      console.log(chalk.red('There is only one local branch.'));

      process.exit(1);
    }

    const result = await prompts([
      {
        type: 'select',
        name: 'branch',
        message: 'Pick a branch',
        choices: otherBranchNames.map(name => ({ title: name, value: name }))
      }
    ]);

    if (result.branch == null) {
      process.exit(1);
    }

    branch = result.branch;
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
    logStepDescription(`Reverting ${migrationVersions.length} migration(s)...`);
  }

  for (const version of migrationVersions) {
    execSync(`VERSION=${version} bin/rake db:migrate:down`, {
      stdio: 'inherit'
    });
  }

  logStepDescription(`Switching to branch '${branch}'...`);

  execSync(`git reset --hard && git checkout ${branch}`);

  if (currentBranchHasRemote()) {
    logStepDescription('Pulling from remote...');

    execSync('git pull');
  }

  if (yarnLockChanged) {
    logStepDescription('Running yarn install...');

    execSync('yarn install', { stdio: 'inherit' });
  }

  if (gemfileLockChanged) {
    logStepDescription('Running bundle install and restarting server...');

    execSync('bundle install', { stdio: 'inherit' });
    execSync('touch tmp/restart.txt');
  }

  logStepDescription('Running migrations...');

  execSync(`bin/rake db:migrate`, {
    stdio: 'inherit'
  });
}

switchToBranch(process.argv[2]).then(
  () => process.exit(0),
  () => process.exit(1)
);
