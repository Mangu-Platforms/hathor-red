jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (req, res, next) => next(),
}));

const jwt = require('jsonwebtoken');
const db = require('../config/database');
const setupSocketHandlers = require('../socket/handlers');
const { REACTION_EMOJIS } = require('../config/constants');

/**
 * Minimal socket.io harness: captures the connection handler, then simulates
 * sockets whose emits are recorded, including room-scoped emits via .to().
 */
function buildHarness() {
  const io = {
    middleware: null,
    connectionHandler: null,
    roomEmits: [],
    use(fn) {
      this.middleware = fn;
    },
    on(event, handler) {
      if (event === 'connection') this.connectionHandler = handler;
    },
    to(room) {
      return {
        emit: (event, payload) => {
          io.roomEmits.push({ room, event, payload });
        },
      };
    },
  };
  setupSocketHandlers(io);
  return io;
}

let socketSeq = 0;
function connectSocket(io, { userId, username }) {
  const socket = {
    id: `sock-${++socketSeq}`,
    userId,
    username,
    handlers: {},
    emits: [],
    targetedEmits: [],
    joined: [],
    handshake: { auth: { token: 'tok' } },
    on(event, handler) {
      this.handlers[event] = handler;
    },
    emit(event, payload) {
      this.emits.push({ event, payload });
    },
    join(room) {
      this.joined.push(room);
    },
    leave() {},
    to(room) {
      return {
        emit: (event, payload) => {
          this.targetedEmits.push({ room, event, payload });
        },
      };
    },
  };
  io.connectionHandler(socket);
  return socket;
}

const ROOM = {
  id: 42,
  host_id: 1,
  current_song_id: 7,
  current_position: 10,
  is_playing: true,
  max_listeners: 50,
  updated_at: new Date().toISOString(),
};

function mockRoomJoinQueries(room = ROOM, participants = 0) {
  db.query.mockImplementation((sql) => {
    if (sql.includes('FROM listening_rooms WHERE id')) return Promise.resolve({ rows: [room] });
    if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: String(participants) }] });
    return Promise.resolve({ rows: [] });
  });
}

describe('socket handlers (Olympus M4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-value';
    // Presence/host maps are module-level; isolate every test.
    setupSocketHandlers.resetStateForTests();
  });

  it('authenticates the handshake JWT with the hathor-music issuer', () => {
    const io = buildHarness();
    const token = jwt.sign({ userId: 1, username: 'max' }, process.env.JWT_SECRET, { issuer: 'hathor-music' });
    const next = jest.fn();
    io.middleware({ handshake: { auth: { token } } }, next);
    expect(next).toHaveBeenCalledWith();

    const bad = jest.fn();
    io.middleware({ handshake: { auth: { token: 'garbage' } } }, bad);
    expect(bad.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('join-room sends a drift-corrected room-state with roster and host', async () => {
    const io = buildHarness();
    mockRoomJoinQueries();
    const socket = connectSocket(io, { userId: 2, username: 'ana' });

    await socket.handlers['join-room'](42);

    const state = socket.emits.find((e) => e.event === 'room-state');
    expect(state).toBeTruthy();
    expect(state.payload.currentSongId).toBe(7);
    expect(state.payload.positionMs).toBeGreaterThanOrEqual(10000);
    expect(state.payload.serverTimeMs).toBeGreaterThan(0);
    expect(state.payload.hostId).toBe(1);
    expect(state.payload.roster).toEqual([expect.objectContaining({ userId: 2, username: 'ana' })]);
  });

  it('sync-ping answers immediately with server time', () => {
    const io = buildHarness();
    const socket = connectSocket(io, { userId: 3, username: 'bo' });

    socket.handlers['sync-ping']({ clientTime: 123 });

    const pong = socket.emits.find((e) => e.event === 'sync-pong');
    expect(pong.payload.clientTime).toBe(123);
    expect(typeof pong.payload.serverTime).toBe('number');
  });

  it('room-reaction fans out whitelisted emoji and rejects others', async () => {
    const io = buildHarness();
    mockRoomJoinQueries();
    const socket = connectSocket(io, { userId: 2, username: 'ana' });
    await socket.handlers['join-room'](42);

    socket.handlers['room-reaction']({ roomId: 42, emoji: REACTION_EMOJIS[0] });
    expect(io.roomEmits.some((e) => e.event === 'room-reaction' && e.room === 'room-42')).toBe(true);

    socket.handlers['room-reaction']({ roomId: 42, emoji: '🧨' });
    expect(socket.emits.some((e) => e.event === 'error' && e.payload.message === 'Unsupported reaction')).toBe(true);
  });

  it('room-control still enforces the host check', async () => {
    const io = buildHarness();
    mockRoomJoinQueries();
    const socket = connectSocket(io, { userId: 2, username: 'ana' }); // not the host
    await socket.handlers['join-room'](42);

    await socket.handlers['room-control']({ roomId: 42, action: 'pause', position: 5 });

    expect(socket.emits.some((e) => e.event === 'error' && /host/i.test(e.payload.message))).toBe(true);
    expect(io.roomEmits.some((e) => e.event === 'room-update')).toBe(false);
  });

  it('host room-update now carries serverTimeMs for drift correction', async () => {
    const io = buildHarness();
    mockRoomJoinQueries();
    const host = connectSocket(io, { userId: 1, username: 'host' });
    await host.handlers['join-room'](42);

    await host.handlers['room-control']({ roomId: 42, action: 'play', position: 30 });

    const update = io.roomEmits.find((e) => e.event === 'room-update');
    expect(update.payload.positionMs).toBe(30000);
    expect(typeof update.payload.serverTimeMs).toBe('number');
  });

  it('hands the room to the longest-present member when the host leaves', async () => {
    const io = buildHarness();
    mockRoomJoinQueries();

    const host = connectSocket(io, { userId: 1, username: 'host' });
    await host.handlers['join-room'](42);
    const fan = connectSocket(io, { userId: 2, username: 'ana' });
    await fan.handlers['join-room'](42);

    await host.handlers['leave-room'](42);

    const handoff = io.roomEmits.find((e) => e.event === 'host-changed');
    expect(handoff).toBeTruthy();
    expect(handoff.payload.newHostId).toBe(2);

    const hostUpdate = db.query.mock.calls.find(([sql]) => sql.includes('SET host_id'));
    expect(hostUpdate[1]).toEqual([2, 42]);
  });

  it('relays WebRTC signaling only to co-present room members', async () => {
    const io = buildHarness();
    mockRoomJoinQueries();

    const alice = connectSocket(io, { userId: 1, username: 'alice' });
    await alice.handlers['join-room'](42);
    const bob = connectSocket(io, { userId: 2, username: 'bob' });
    await bob.handlers['join-room'](42);

    alice.handlers['rtc-offer']({ roomId: 42, targetUserId: 2, payload: { sdp: 'offer' } });
    const relayed = alice.targetedEmits.find((e) => e.event === 'rtc-offer');
    expect(relayed.room).toBe('user-2');
    expect(relayed.payload.fromUserId).toBe(1);

    // target not in the room → dropped silently
    alice.targetedEmits.length = 0;
    alice.handlers['rtc-offer']({ roomId: 42, targetUserId: 99, payload: { sdp: 'offer' } });
    expect(alice.targetedEmits).toHaveLength(0);
  });

  it('persists room chat best-effort without blocking delivery', async () => {
    const io = buildHarness();
    mockRoomJoinQueries();
    const socket = connectSocket(io, { userId: 2, username: 'ana' });
    await socket.handlers['join-room'](42);

    db.query.mockRejectedValueOnce(new Error('db down')); // the INSERT fails
    await socket.handlers['room-chat']({ roomId: 42, message: '<b>hi</b>' });

    const delivered = io.roomEmits.find((e) => e.event === 'chat-message');
    expect(delivered.payload.message).toBe('&lt;b&gt;hi&lt;/b&gt;');
  });

  it('drops chat from sockets that never joined the room', async () => {
    const io = buildHarness();
    mockRoomJoinQueries();
    const outsider = connectSocket(io, { userId: 9, username: 'lurker' });

    await outsider.handlers['room-chat']({ roomId: 42, message: 'sneaky' });

    expect(io.roomEmits.some((e) => e.event === 'chat-message')).toBe(false);
  });

  it('rate limits chat floods per socket', async () => {
    const io = buildHarness();
    mockRoomJoinQueries();
    const socket = connectSocket(io, { userId: 2, username: 'ana' });
    await socket.handlers['join-room'](42);

    for (let i = 0; i < 6; i += 1) {
      await socket.handlers['room-chat']({ roomId: 42, message: `msg ${i}` });
    }

    const delivered = io.roomEmits.filter((e) => e.event === 'chat-message');
    expect(delivered.length).toBe(3); // 3 per rolling second
    expect(socket.emits.some((e) => e.event === 'error' && e.payload.message === 'Slow down')).toBe(true);
  });

  it('ignores leave-room for rooms the socket never joined', async () => {
    const io = buildHarness();
    mockRoomJoinQueries();
    const outsider = connectSocket(io, { userId: 9, username: 'lurker' });

    await outsider.handlers['leave-room'](42);

    expect(io.roomEmits.some((e) => e.event === 'host-changed')).toBe(false);
    expect(outsider.targetedEmits.some((e) => e.event === 'user-left')).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM room_participants'))).toBe(false);
  });

  it('withholds room-state snapshots from non-members', async () => {
    const io = buildHarness();
    mockRoomJoinQueries();
    const outsider = connectSocket(io, { userId: 9, username: 'lurker' });

    await outsider.handlers['request-room-state'](42);

    expect(outsider.emits.some((e) => e.event === 'room-state')).toBe(false);
  });

  it('departs the previous room when a socket joins another', async () => {
    const io = buildHarness();
    const roomA = { ...ROOM, id: 42 };
    const roomB = { ...ROOM, id: 43 };
    db.query.mockImplementation((sql, params) => {
      if (sql.includes('FROM listening_rooms WHERE id')) {
        return Promise.resolve({ rows: [params[0] === 42 ? roomA : roomB] });
      }
      if (sql.includes('COUNT(*)')) return Promise.resolve({ rows: [{ count: '0' }] });
      return Promise.resolve({ rows: [] });
    });

    const socket = connectSocket(io, { userId: 2, username: 'ana' });
    await socket.handlers['join-room'](42);
    await socket.handlers['join-room'](43);

    expect(socket.currentRoom).toBe(43);
    // The old room's participant row was cleaned up — no ghost membership.
    const cleanup = db.query.mock.calls.find(([sql, params]) =>
      sql.includes('DELETE FROM room_participants') && params[0] === 42);
    expect(cleanup).toBeTruthy();

    // …and the old room no longer receives this socket's chat.
    await socket.handlers['room-chat']({ roomId: 42, message: 'ghost?' });
    expect(io.roomEmits.some((e) => e.event === 'chat-message' && e.room === 'room-42')).toBe(false);
  });

  it('keeps a multi-tab user present until the last socket leaves', async () => {
    const io = buildHarness();
    mockRoomJoinQueries();

    const tab1 = connectSocket(io, { userId: 2, username: 'ana' });
    await tab1.handlers['join-room'](42);
    const tab2 = connectSocket(io, { userId: 2, username: 'ana' });
    await tab2.handlers['join-room'](42);

    await tab1.handlers['leave-room'](42);
    // First tab leaving must not announce or delete the participant row.
    expect(db.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM room_participants'))).toBe(false);

    await tab2.handlers['leave-room'](42);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('DELETE FROM room_participants'))).toBe(true);
  });
});
