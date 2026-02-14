import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Super Source Looks — Save/Recall System
// ---------------------------------------------------------------------------
// Stores complete Super Source snapshots (boxes, art, border) as JSON files
// in ~/.atem-mcp/looks/ so they survive server restarts and can be recalled
// later with different sources.
// ---------------------------------------------------------------------------

const LOOKS_DIR = path.join(os.homedir(), '.atem-mcp', 'looks');

export interface LookBox {
  enabled: boolean;
  source: number;
  sourceName?: string;
  x: number;
  y: number;
  size: number;
  cropped: boolean;
  cropTop: number;
  cropBottom: number;
  cropLeft: number;
  cropRight: number;
}

export interface LookArt {
  artFillSource: number;
  artCutSource: number;
  artOption: number; // SuperSourceArtOption enum value
  artPreMultiplied: boolean;
  artClip: number;
  artGain: number;
  artInvertKey: boolean;
}

export interface LookBorder {
  borderEnabled: boolean;
  borderBevel: number;
  borderOuterWidth: number;
  borderInnerWidth: number;
  borderOuterSoftness: number;
  borderInnerSoftness: number;
  borderBevelSoftness: number;
  borderBevelPosition: number;
  borderHue: number;
  borderSaturation: number;
  borderLuma: number;
  borderLightSourceDirection: number;
  borderLightSourceAltitude: number;
}

export interface LookUSK {
  usk: number;
  type: string;           // 'luma' | 'chroma' | 'pattern' | 'dve'
  flyEnabled: boolean;
  fillSource: number;
  fillSourceName?: string;
  onAir: boolean;
  dve?: {
    sizeX: number;
    sizeY: number;
    positionX: number;
    positionY: number;
    rotation?: number;
    maskEnabled: boolean;
    maskTop?: number;
    maskBottom?: number;
    maskLeft?: number;
    maskRight?: number;
    borderEnabled?: boolean;
    borderOuterWidth?: number;
    borderInnerWidth?: number;
    shadowEnabled?: boolean;
  };
  keyerMask?: {
    maskEnabled: boolean;
    maskTop: number;
    maskBottom: number;
    maskLeft: number;
    maskRight: number;
  };
}

export interface Look {
  name: string;
  description?: string;
  createdAt: string;
  boxes: LookBox[];
  art?: LookArt;
  border?: LookBorder;
  upstreamKeyers?: LookUSK[];
}

/** Ensure the looks directory exists */
async function ensureDir(): Promise<void> {
  await fs.mkdir(LOOKS_DIR, { recursive: true });
}

/** Sanitize a look name for use as a filename (alphanumeric, dash, underscore) */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

/** Get the file path for a look */
function lookPath(name: string): string {
  return path.join(LOOKS_DIR, `${sanitizeName(name)}.json`);
}

/**
 * Save a look to disk.
 */
export async function saveLook(look: Look): Promise<string> {
  await ensureDir();
  const filePath = lookPath(look.name);
  await fs.writeFile(filePath, JSON.stringify(look, null, 2), 'utf-8');
  return filePath;
}

/**
 * Load a look from disk by name.
 * Returns null if not found.
 */
export async function loadLook(name: string): Promise<Look | null> {
  const filePath = lookPath(name);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as Look;
  } catch {
    return null;
  }
}

/**
 * List all saved looks.
 * Returns array of looks with basic metadata (name, description, date, enabled box count).
 */
export async function listLooks(): Promise<{ name: string; description?: string; createdAt: string; enabledBoxes: number; filePath: string }[]> {
  await ensureDir();
  const files = await fs.readdir(LOOKS_DIR);
  const looks: { name: string; description?: string; createdAt: string; enabledBoxes: number; filePath: string }[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const filePath = path.join(LOOKS_DIR, file);
      const data = await fs.readFile(filePath, 'utf-8');
      const look = JSON.parse(data) as Look;
      looks.push({
        name: look.name,
        description: look.description,
        createdAt: look.createdAt,
        enabledBoxes: look.boxes.filter(b => b.enabled).length,
        filePath,
      });
    } catch {
      // Skip invalid JSON files
    }
  }

  // Sort by creation date (newest first)
  looks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return looks;
}

/**
 * Delete a saved look by name.
 * Returns true if deleted, false if not found.
 */
export async function deleteLook(name: string): Promise<boolean> {
  const filePath = lookPath(name);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Get the looks directory path (for display purposes) */
export function getLooksDir(): string {
  return LOOKS_DIR;
}
