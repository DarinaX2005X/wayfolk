// Light entry: the page shell and the router only. Three.js, IWSDK and the scene live in
// src/app/boot/ and arrive as a separate chunk when a page asks for them.
import './pages/shell.css';
import { route } from './pages/router';
import { muteUnderAutomation } from './app/boot/mute';

muteUnderAutomation();

void route();
