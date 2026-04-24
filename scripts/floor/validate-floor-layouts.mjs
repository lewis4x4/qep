#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "../_shared/local-env.mjs";

const repoRoot = resolve(import.meta.dir, "..", "..");
loadLocalEnv(repoRoot);

const registryPath = resolve(repoRoot, "apps/web/src/features/floor/lib/floor-widget-registry.tsx");
const defaultsPath = resolve(repoRoot, "apps/web/src/features/floor/lib/default-layouts.ts");
const floorPagePath = resolve(repoRoot, "apps/web/src/features/floor/pages/FloorPage.tsx");

const registrySource = readFileSync(registryPath, "utf8");
const defaultsSource = readFileSync(defaultsPath, "utf8");
const floorPageSource = readFileSync(floorPagePath, "utf8");

const CANONICAL_QUICK_ACTION_ICONS = new Set([
  "activity",
  "approve",
  "box",
  "check",
  "clipboard",
  "credit",
  "drafts",
  "money",
  "parts",
  "quote",
  "search",
  "spark",
  "sparkles",
  "trending",
  "users",
  "visit",
  "voice",
  "wrench",
]);

const errors = [];
const warnings = [];

const registry = parseRegistry(registrySource);
const validIcons = parseIconMap(floorPageSource);

validateRegistry(registry);
validateLocalDefaults(defaultsSource, registry, validIcons);
await validateRemoteLayouts(registry, validIcons);

if (warnings.length > 0) {
  for (const warning of warnings) console.warn(`WARN ${warning}`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      verdict: "PASS",
      registry_ids: registry.size,
      valid_quick_action_icons: validIcons.size,
      warnings,
    },
    null,
    2,
  ),
);

function parseRegistry(source) {
  const start = source.indexOf("export const FLOOR_WIDGET_REGISTRY");
  if (start === -1) throw new Error("FLOOR_WIDGET_REGISTRY export not found");

  const entries = new Map();
  const keyRegex = /^\s*"([^"]+)":\s*\{/gm;
  const registryBody = source.slice(start);
  const matches = [...registryBody.matchAll(keyRegex)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const id = match[1];
    const absoluteBlockStart = start + match.index;
    const nextMatch = matches[index + 1];
    const absoluteBlockEnd = nextMatch
      ? start + nextMatch.index
      : source.indexOf("\n};", absoluteBlockStart);
    const block = source.slice(absoluteBlockStart, absoluteBlockEnd);
    entries.set(id, {
      id,
      hasComponent: /\bcomponent\s*:/.test(block),
    });
  }
  return entries;
}

function parseIconMap(source) {
  const mapStart = source.indexOf("QUICK_ACTION_ICON_MAP");
  if (mapStart === -1) {
    return CANONICAL_QUICK_ACTION_ICONS;
  }
  const mapEnd = source.indexOf("};", mapStart);
  const body = source.slice(mapStart, mapEnd);
  return new Set([...body.matchAll(/^\s*([A-Za-z0-9_-]+)\s*:/gm)].map((match) => match[1]));
}

function validateRegistry(registry) {
  if (registry.size === 0) errors.push("registry has zero widget ids");
  for (const [id, descriptor] of registry.entries()) {
    if (id !== descriptor.id) errors.push(`registry key ${id} does not match descriptor id`);
    if (!descriptor.hasComponent) errors.push(`registry id ${id} has no component`);
  }
}

function validateLocalDefaults(source, registry, validIcons) {
  for (const role of parseRoleBlocks(source)) {
    const widgetIds = [...role.widgets.matchAll(/\bid\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
    if (widgetIds.length > 6) {
      errors.push(`default layout ${role.name} has ${widgetIds.length} widgets; cap is 6`);
    }
    for (const id of widgetIds) {
      if (!registry.has(id)) errors.push(`default layout ${role.name} references unknown widget id ${id}`);
    }

    const quickActions = parseQuickActions(role.quickActions);
    if (quickActions.length > 3) {
      errors.push(`default layout ${role.name} has ${quickActions.length} quick actions; cap is 3`);
    }
    for (const action of quickActions) validateQuickAction(`default layout ${role.name}`, action, validIcons);
  }
}

function parseRoleBlocks(source) {
  const roles = [];
  const roleRegex = /^\s*(iron_[a-z_]+):\s*\{/gm;
  const matches = [...source.matchAll(roleRegex)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const name = match[1];
    const start = match.index;
    const next = matches[index + 1];
    const end = next ? next.index : source.indexOf("\n};", start);
    const block = source.slice(start, end);
    roles.push({
      name,
      widgets: extractArrayBlock(block, "widgets"),
      quickActions: extractArrayBlock(block, "quickActions"),
    });
  }
  return roles;
}

function extractArrayBlock(block, property) {
  const index = block.indexOf(`${property}: [`);
  if (index === -1) return "";
  const open = block.indexOf("[", index);
  let depth = 0;
  for (let i = open; i < block.length; i += 1) {
    if (block[i] === "[") depth += 1;
    if (block[i] === "]") {
      depth -= 1;
      if (depth === 0) return block.slice(open, i + 1);
    }
  }
  return "";
}

function parseQuickActions(arrayBlock) {
  const actions = [];
  const objectRegex = /\{([\s\S]*?)\}/g;
  let match;
  while ((match = objectRegex.exec(arrayBlock))) {
    const objectSource = match[1];
    actions.push({
      id: readStringProperty(objectSource, "id"),
      label: readStringProperty(objectSource, "label"),
      route: readStringProperty(objectSource, "route"),
      icon: readStringProperty(objectSource, "icon"),
    });
  }
  return actions.filter((action) => action.id || action.label || action.route || action.icon);
}

function readStringProperty(source, property) {
  const match = source.match(new RegExp(`\\b${property}\\s*:\\s*"([^"]*)"`));
  return match?.[1] ?? "";
}

function validateQuickAction(scope, action, validIcons) {
  if (!action.label.trim()) errors.push(`${scope} quick action ${action.id || "(missing id)"} missing label`);
  if (!isSafeRoute(action.route)) {
    errors.push(`${scope} quick action ${action.id || action.label || "(unknown)"} has invalid route ${action.route}`);
  }
  if (action.icon && !validIcons.has(action.icon)) {
    errors.push(`${scope} quick action ${action.id || action.label || "(unknown)"} has invalid icon ${action.icon}`);
  }
}

function isSafeRoute(route) {
  return /^\/(?!\/)[A-Za-z0-9/_:?.=&%#-]*$/.test(route);
}

async function validateRemoteLayouts(registry, validIcons) {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    warnings.push("remote floor_layouts skipped; SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY unavailable");
    return;
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from("floor_layouts")
    .select("id, workspace_id, iron_role, user_id, layout_json");

  if (error) {
    errors.push(`remote floor_layouts query failed: ${error.message}`);
    return;
  }

  for (const row of data ?? []) {
    const scope = `remote layout ${row.workspace_id}/${row.iron_role}${row.user_id ? `/${row.user_id}` : ""}`;
    const layout = row.layout_json ?? {};
    const widgets = Array.isArray(layout.widgets) ? layout.widgets : [];
    const quickActions = Array.isArray(layout.quickActions) ? layout.quickActions : [];
    if (widgets.length > 6) errors.push(`${scope} has ${widgets.length} widgets; cap is 6`);
    if (quickActions.length > 3) errors.push(`${scope} has ${quickActions.length} quick actions; cap is 3`);
    for (const widget of widgets) {
      if (!widget?.id || !registry.has(widget.id)) {
        errors.push(`${scope} references unknown widget id ${widget?.id ?? "(missing id)"}`);
      }
    }
    for (const action of quickActions) validateQuickAction(scope, action, validIcons);
  }
}
