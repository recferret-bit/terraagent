import { bootProductAnalytics } from '../analytics/boot';
import { rewriteSubdomainLinks } from './subdomainLinks';

if (typeof document !== 'undefined') {
  rewriteSubdomainLinks();
  bootProductAnalytics(document.getElementById('nf-heading') ? 'not_found' : 'design');
}
