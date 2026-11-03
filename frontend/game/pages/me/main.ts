import '../../../design/css/tokens.css';
import '../../../design/css/base.css';
import './me.css';
import { mountMePage } from './MePage';

const root = document.getElementById('app');
if (root) {
  mountMePage(root);
}
