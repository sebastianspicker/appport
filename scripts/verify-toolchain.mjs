#!/usr/bin/env node

const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(process.version);
if (!match) {
  throw new Error(`Unable to parse Node version ${process.version}.`);
}

const [, major, minor] = match.map(Number);
if (major !== 24 || minor !== 18) {
  throw new Error(
    `Node 24.18.x is required for alpha verification; found ${process.version}.`,
  );
}
