import type { Role, RoomSettings } from '@pokr/shared';

/** SQLite persistence for one room. Stateless: every call reads storage (AC30). */

export interface RoomRecord {
  roomId: string;
  settings: RoomSettings;
  topic: string;
  phase: 'voting' | 'revealed';
  roundNumber: number;
  version: number;
  facilitatorId: string;
  nextSeq: number;
  /** Test-mode timer overrides (ignored outside test mode). */
  timers: {
    heartbeatTimeoutMs?: number | undefined;
    offlinePurgeMs?: number | undefined;
    facilitatorClaimMs?: number | undefined;
    joinTimeoutMs?: number | undefined;
  };
  /** offline_since value of the facilitator for which the claim-available push was sent. */
  claimPushed: number | null;
  lastClaimAt: number | null;
}

export interface ParticipantRow {
  id: string;
  token_hash: string;
  base_name: string;
  suffix: number;
  display_name: string;
  role: Role;
  vote: string | null;
  seq: number;
  offline_since: number | null;
}

export interface LeftRow {
  participant_id: string;
  name: string;
  card: string;
}

type Row = Record<string, SqlStorageValue>;

const PARTICIPANT_COLUMNS = new Set([
  'base_name',
  'suffix',
  'display_name',
  'role',
  'vote',
  'offline_since',
]);

export class RoomStore {
  constructor(private readonly sql: SqlStorage) {}

  /** Read-only check; creates nothing (F01-AC6). */
  exists(): boolean {
    return (
      this.sql.exec("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='room'").toArray()
        .length > 0
    );
  }

  init(room: RoomRecord): void {
    this.sql.exec(`CREATE TABLE room (
      id INTEGER PRIMARY KEY CHECK (id = 1), room_id TEXT NOT NULL,
      settings TEXT NOT NULL, topic TEXT NOT NULL, phase TEXT NOT NULL,
      round_number INTEGER NOT NULL, version INTEGER NOT NULL, facilitator_id TEXT NOT NULL,
      next_seq INTEGER NOT NULL, timers TEXT NOT NULL, claim_pushed INTEGER, last_claim_at INTEGER)`);
    this.sql.exec(`CREATE TABLE participants (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, base_name TEXT NOT NULL,
      suffix INTEGER NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, vote TEXT,
      seq INTEGER NOT NULL, offline_since INTEGER)`);
    this.sql.exec(`CREATE TABLE left_votes (
      participant_id TEXT PRIMARY KEY, name TEXT NOT NULL, card TEXT NOT NULL)`);
    this.sql.exec(
      'INSERT INTO room VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      room.roomId,
      JSON.stringify(room.settings),
      room.topic,
      room.phase,
      room.roundNumber,
      room.version,
      room.facilitatorId,
      room.nextSeq,
      JSON.stringify(room.timers),
      room.claimPushed,
      room.lastClaimAt,
    );
  }

  room(): RoomRecord {
    const r = this.sql.exec<Row>('SELECT * FROM room WHERE id = 1').one();
    return {
      roomId: r['room_id'] as string,
      settings: JSON.parse(r['settings'] as string) as RoomSettings,
      topic: r['topic'] as string,
      phase: r['phase'] as 'voting' | 'revealed',
      roundNumber: r['round_number'] as number,
      version: r['version'] as number,
      facilitatorId: r['facilitator_id'] as string,
      nextSeq: r['next_seq'] as number,
      timers: JSON.parse(r['timers'] as string) as RoomRecord['timers'],
      claimPushed: r['claim_pushed'] as number | null,
      lastClaimAt: r['last_claim_at'] as number | null,
    };
  }

  setSettings(settings: RoomSettings): void {
    this.sql.exec('UPDATE room SET settings = ? WHERE id = 1', JSON.stringify(settings));
  }
  setTopic(topic: string): void {
    this.sql.exec('UPDATE room SET topic = ? WHERE id = 1', topic);
  }
  setRound(phase: 'voting' | 'revealed', roundNumber: number): void {
    this.sql.exec('UPDATE room SET phase = ?, round_number = ? WHERE id = 1', phase, roundNumber);
  }
  setVersion(version: number): void {
    this.sql.exec('UPDATE room SET version = ? WHERE id = 1', version);
  }
  setFacilitator(id: string, claimAt: number | null): void {
    this.sql.exec(
      'UPDATE room SET facilitator_id = ?, last_claim_at = COALESCE(?, last_claim_at) WHERE id = 1',
      id,
      claimAt,
    );
  }
  setTimers(timers: RoomRecord['timers']): void {
    this.sql.exec('UPDATE room SET timers = ? WHERE id = 1', JSON.stringify(timers));
  }
  setClaimPushed(v: number | null): void {
    this.sql.exec('UPDATE room SET claim_pushed = ? WHERE id = 1', v);
  }
  takeSeq(): number {
    const seq = this.sql.exec<Row>('SELECT next_seq FROM room WHERE id = 1').one()[
      'next_seq'
    ] as number;
    this.sql.exec('UPDATE room SET next_seq = ? WHERE id = 1', seq + 1);
    return seq;
  }

  participants(): ParticipantRow[] {
    return this.sql
      .exec<Row>('SELECT * FROM participants ORDER BY seq')
      .toArray() as unknown as ParticipantRow[];
  }
  participant(id: string): ParticipantRow | undefined {
    return this.sql
      .exec<Row>('SELECT * FROM participants WHERE id = ?', id)
      .toArray()[0] as unknown as ParticipantRow | undefined;
  }
  participantByHash(hash: string): ParticipantRow | undefined {
    return this.sql
      .exec<Row>('SELECT * FROM participants WHERE token_hash = ?', hash)
      .toArray()[0] as unknown as ParticipantRow | undefined;
  }
  insertParticipant(p: ParticipantRow): void {
    this.sql.exec(
      'INSERT INTO participants VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      p.id,
      p.token_hash,
      p.base_name,
      p.suffix,
      p.display_name,
      p.role,
      p.vote,
      p.seq,
      p.offline_since,
    );
  }
  updateParticipant(
    id: string,
    patch: Partial<Omit<ParticipantRow, 'id' | 'token_hash' | 'seq'>>,
  ): void {
    const entries = Object.entries(patch).filter(([k]) => PARTICIPANT_COLUMNS.has(k));
    if (entries.length === 0) return;
    const set = entries.map(([k]) => `${k} = ?`).join(', '); // keys come from the whitelist above
    this.sql.exec(
      `UPDATE participants SET ${set} WHERE id = ?`,
      ...entries.map(([, v]) => v as SqlStorageValue),
      id,
    );
  }
  deleteParticipant(id: string): void {
    this.sql.exec('DELETE FROM participants WHERE id = ?', id);
  }
  clearVotes(): void {
    this.sql.exec('UPDATE participants SET vote = NULL WHERE vote IS NOT NULL');
  }

  left(): LeftRow[] {
    return this.sql
      .exec<Row>('SELECT * FROM left_votes ORDER BY rowid')
      .toArray() as unknown as LeftRow[];
  }
  insertLeft(row: LeftRow): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO left_votes VALUES (?, ?, ?)',
      row.participant_id,
      row.name,
      row.card,
    );
  }
  clearLeft(): void {
    this.sql.exec('DELETE FROM left_votes');
  }
}
