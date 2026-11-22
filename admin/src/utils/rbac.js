// Role-Based Access Control mapping for Admin Dashboard navigation and routes.

export const ADMIN_ROLES = ['super_admin', 'admin', 'fulfillment', 'support', 'marketing'];

export const ROUTE_PERMISSIONS = {
  '/':                     ['super_admin', 'admin', 'fulfillment', 'support', 'marketing'],
  '/analytics':           ['super_admin', 'admin', 'marketing'],
  '/financials':          ['super_admin', 'admin'],
  '/orders':              ['super_admin', 'admin', 'fulfillment', 'support'],
  '/orders/:id':          ['super_admin', 'admin', 'fulfillment', 'support'],
  '/requests':            ['super_admin', 'admin', 'fulfillment', 'support'],
  '/products':            ['super_admin', 'admin', 'marketing'],
  '/products/new':        ['super_admin', 'admin', 'marketing'],
  '/products/:id':        ['super_admin', 'admin', 'marketing'],
  '/inventory':           ['super_admin', 'admin', 'fulfillment'],
  '/customers':           ['super_admin', 'admin', 'support'],
  '/customers/:id':       ['super_admin', 'admin', 'support'],
  '/reviews':             ['super_admin', 'admin', 'support', 'marketing'],
  '/coupons':             ['super_admin', 'admin', 'marketing'],
  '/promotions':          ['super_admin', 'admin', 'marketing'],
  '/newsletter/compose':     ['super_admin', 'admin', 'marketing'],
  '/newsletter/subscribers': ['super_admin', 'admin', 'marketing'],
  '/newsletter/history':     ['super_admin', 'admin', 'marketing'],
  '/storefront':          ['super_admin', 'admin'],
  '/theme':               ['super_admin', 'admin'],
  '/settings':            ['super_admin', 'admin'],
  '/settings/admins':     ['super_admin', 'admin'],
};

export function isRouteAllowed(path, role) {
  if (!role) return false;
  if (role === 'admin' || role === 'super_admin') return true;

  // Direct match
  if (ROUTE_PERMISSIONS[path]) {
    return ROUTE_PERMISSIONS[path].includes(role);
  }

  // Prefix match for parameterized routes e.g. /orders/123 -> /orders
  const matchedRoute = Object.keys(ROUTE_PERMISSIONS).find(pattern => {
    if (pattern === '/') return false;
    if (pattern.includes(':')) {
      const prefix = pattern.split('/:')[0];
      return path.startsWith(prefix);
    }
    return path.startsWith(pattern);
  });

  if (matchedRoute) {
    return ROUTE_PERMISSIONS[matchedRoute].includes(role);
  }

  return false;
}

export function filterNavGroupsByRole(groups, role) {
  if (!role) return [];
  if (role === 'admin' || role === 'super_admin') return groups;

  return groups
    .map(group => {
      const filteredItems = group.items.filter(item => isRouteAllowed(item.to, role));
      return { ...group, items: filteredItems };
    })
    .filter(group => group.items.length > 0);
}
