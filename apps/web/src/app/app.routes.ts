import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'pokr',
    loadComponent: () => import('./start/start-page').then((m) => m.StartPage),
  },
  {
    path: 'r/:roomId',
    loadComponent: () => import('./room/room-page').then((m) => m.RoomPage),
  },
  { path: '**', redirectTo: '' },
];
