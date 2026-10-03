// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Boards are saved to IndexedDB in the browser; these checks keep everything in memory.
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined), del: vi.fn(async () => undefined) }));

const { settleBoard, useBoards, newBoard } = await import('../../src/store/boards');
type Board = ReturnType<typeof newBoard>;

const store = () => useBoards.getState();
const board = () => store().boards[store().currentId];
// Undo merges changes made within 80 ms (one click can fire several), so each step moves the clock on.
let clock = 1_000_000;
const tick = () => (clock += 1000);

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  tick();
  store().createBoard('Test board');
  store().addNodes([
    { id: 'a', type: 'note', position: { x: 0, y: 0 }, data: { title: 'A' } },
    { id: 'b', type: 'note', position: { x: 300, y: 0 }, data: { title: 'B' } },
    { id: 'c', type: 'note', position: { x: 600, y: 0 }, data: { title: 'C' } },
  ]);
  store().addEdges([
    { id: 'ab', source: 'a', target: 'b', type: 'string', data: { kind: 'user' } },
    { id: 'bc', source: 'b', target: 'c', type: 'string', data: { kind: 'user' } },
  ]);
  tick();
});

describe('strings follow their cards', () => {
  it('removing a card through the change list takes its strings with it', () => {
    store().onNodesChange([{ id: 'b', type: 'remove' }]);
    expect(board().nodes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(board().edges).toEqual([]);
  });

  it('dropNodes removes cards and strings without an undo step', () => {
    store().dropNodes(['c']);
    expect(board().nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(board().edges.map((e) => e.id)).toEqual(['ab']);
    expect(store().undo()).toBeUndefined();
  });

  it('removeNodes can be undone', () => {
    store().removeNodes(['a']);
    expect(board().edges.map((e) => e.id)).toEqual(['bc']);
    tick();
    expect(store().undo()).toMatch(/Unpinned 1 card/);
    expect(board().nodes).toHaveLength(3);
    expect(board().edges).toHaveLength(2);
  });

  it('addEdges skips duplicates, reversed duplicates, loops and missing cards', () => {
    store().addEdges([
      { id: 'dup', source: 'a', target: 'b', type: 'string' },
      { id: 'rev', source: 'b', target: 'a', type: 'string' },
      { id: 'loop', source: 'a', target: 'a', type: 'string' },
      { id: 'ghost', source: 'a', target: 'nobody', type: 'string' },
      { id: 'ac', source: 'a', target: 'c', type: 'string' },
    ]);
    expect(board().edges.map((e) => e.id)).toEqual(['ab', 'bc', 'ac']);
  });
});

describe('loading a saved board', () => {
  it('drops strings that point at missing cards and stops anything mid-flight', () => {
    const saved = {
      ...newBoard('Saved'),
      nodes: [{ id: 'x', type: 'topic', position: { x: 0, y: 0 }, data: { title: 'Case', status: 'digging' } }],
      edges: [
        { id: 'ok', source: 'x', target: 'x', type: 'string' },
        { id: 'dangling', source: 'x', target: 'gone', type: 'string' },
      ],
      chat: [{ id: 'm', role: 'assistant', content: '', pending: true }],
    } as unknown as Board;
    const b = settleBoard(saved);
    expect(b.edges.map((e) => e.id)).toEqual(['ok']);
    expect(b.nodes[0].data.status).toBe('error');
    expect(b.chat[0]).toMatchObject({ pending: false, error: true });
  });

  it('fills in parts an older or partial board may lack', () => {
    const b = settleBoard({ id: 'old', name: 'Old', emoji: '🕳️', createdAt: 0, updatedAt: 0, nodes: [], caseCounter: 0 } as unknown as Board);
    expect(b).toMatchObject({ edges: [], chat: [], timeline: [], trail: [] });
  });
});

describe('timeline moments', () => {
  beforeEach(() => {
    store().addTimeline([
      { id: 't1', date: '1908-06-30', event: 'Blast', clusterId: 'c' },
      { id: 't2', date: '1927', event: 'Kulik arrives', clusterId: 'c' },
    ]);
    tick();
  });

  it('edits and removes a moment, and both can be undone', () => {
    store().editTimeline('t2', { event: 'Kulik expedition', id: 'sneaky' });
    expect(board().timeline.map((t) => `${t.id}:${t.event}`)).toEqual(['t1:Blast', 't2:Kulik expedition']);
    tick();
    store().editTimeline('t1', null);
    expect(board().timeline.map((t) => t.id)).toEqual(['t2']);
    tick();
    expect(store().undo()).toBe('Removed a moment');
    tick();
    expect(store().undo()).toBe('Edited a moment');
    expect(board().timeline.map((t) => t.event)).toEqual(['Blast', 'Kulik arrives']);
  });
});

describe('changes the account sync must notice', () => {
  it('renaming or re-badging a board moves its "last changed" clock', () => {
    const id = store().currentId;
    const before = board().updatedAt;
    tick();
    store().renameBoard(id, 'Renamed');
    expect(board().updatedAt).toBeGreaterThan(before);
    const renamed = board().updatedAt;
    tick();
    store().setEmoji(id, '🦉');
    expect(board().updatedAt).toBeGreaterThan(renamed);
  });
});
