import '../../../design/css/tokens.css';
import '../../../design/css/base.css';
import '../../features/deed/deedCardArt.css';
import './deedPage.css';
import { mountDeedSharePage } from './DeedSharePage';

const root = document.getElementById('app');
if (root) {
  mountDeedSharePage(root);
}
