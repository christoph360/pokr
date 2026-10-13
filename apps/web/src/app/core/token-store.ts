import { Injectable } from '@angular/core';

const PREFIX = 'pokr:token:';

/** One participant token per room in localStorage (F01-AC5). Storage failures degrade to "no token". */
@Injectable({ providedIn: 'root' })
export class TokenStore {
  get(roomId: string): string | null {
    try {
      return localStorage.getItem(PREFIX + roomId);
    } catch {
      return null;
    }
  }

  set(roomId: string, token: string): void {
    try {
      localStorage.setItem(PREFIX + roomId, token);
    } catch {
      /* storage unavailable: the participant will rejoin as a new one next time */
    }
  }

  clear(roomId: string): void {
    try {
      localStorage.removeItem(PREFIX + roomId);
    } catch {
      /* ignore */
    }
  }
}
