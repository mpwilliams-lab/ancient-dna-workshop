// Stub entry (Task 6). The main/shell task replaces this file with the real wiring.
import { APP_TITLE } from './content';
import { DATA } from './data';

const app = document.getElementById('app');
if (app) {
  app.textContent = APP_TITLE;
  app.dataset.periods = String(DATA.periods.length);
}
