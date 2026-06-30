#!/usr/bin/env node
// scripts/linear-whoami.mjs
// Prints the Linear user associated with LINEAR_API_KEY. Use the printed ID
// as LINEAR_SYNC_USER_ID in the reverse Edge Function secrets — the function
// uses it to skip webhooks fired by its own writes (anti-ping-pong).

import { LinearClient } from './lib/linear.mjs';

const { LINEAR_API_KEY } = process.env;
if (!LINEAR_API_KEY) {
  console.error('LINEAR_API_KEY env var is required.');
  process.exit(2);
}

const linear = new LinearClient(LINEAR_API_KEY);
const data = await linear.gql(`
  query {
    viewer { id name email displayName admin createdAt }
  }
`);

const v = data.viewer;
console.log('Linear identity for this API key:');
console.log(`  ID:          ${v.id}`);
console.log(`  Name:        ${v.name}`);
console.log(`  Email:       ${v.email}`);
console.log(`  Display:     ${v.displayName}`);
console.log(`  Admin:       ${v.admin}`);
console.log(`  Created:     ${v.createdAt}`);
console.log('');
console.log('Add this to your Supabase function secrets:');
console.log(`  supabase secrets set LINEAR_SYNC_USER_ID=${v.id}`);
console.log('');
console.log('And/or set it locally for scripts:');
console.log(`  LINEAR_SYNC_USER_ID=${v.id}`);
