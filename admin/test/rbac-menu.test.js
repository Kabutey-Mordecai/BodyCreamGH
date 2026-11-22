import test from 'node:test';
import assert from 'node:assert/strict';
import { filterNavGroupsByRole, isRouteAllowed } from '../src/utils/rbac.js';

const SAMPLE_NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { to: '/',           label: 'Dashboard' },
      { to: '/analytics',  label: 'Analytics' },
      { to: '/financials', label: 'Financials' },
    ],
  },
  {
    label: 'Sell',
    items: [
      { to: '/orders',     label: 'Orders' },
      { to: '/requests',   label: 'Requests' },
      { to: '/products',   label: 'Products' },
      { to: '/inventory',  label: 'Inventory' },
      { to: '/customers',  label: 'Customers' },
      { to: '/reviews',    label: 'Reviews' },
      { to: '/coupons',    label: 'Coupons' },
      { to: '/promotions', label: 'Promotions' },
    ],
  },
  {
    label: 'Newsletter',
    items: [
      { to: '/newsletter/compose',     label: 'Compose' },
      { to: '/newsletter/subscribers', label: 'Subscribers' },
      { to: '/newsletter/history',     label: 'History' },
    ],
  },
  {
    label: 'Customize',
    items: [
      { to: '/storefront',      label: 'Storefront Editor' },
      { to: '/theme',           label: 'Theme & Colors' },
      { to: '/settings',        label: 'Settings' },
      { to: '/settings/admins', label: 'Admin Accounts' },
    ],
  },
];

function extractMenuPaths(filteredGroups) {
  return filteredGroups.flatMap(g => g.items.map(i => i.to));
}

test('super_admin and admin roles see all nav groups and links', () => {
  for (const role of ['admin', 'super_admin']) {
    const groups = filterNavGroupsByRole(SAMPLE_NAV_GROUPS, role);
    assert.strictEqual(groups.length, SAMPLE_NAV_GROUPS.length);
    const paths = extractMenuPaths(groups);
    assert.ok(paths.includes('/financials'));
    assert.ok(paths.includes('/settings/admins'));
    assert.ok(paths.includes('/orders'));
    assert.ok(paths.includes('/inventory'));
    assert.ok(paths.includes('/newsletter/compose'));
  }
});

test('fulfillment role sees only fulfillment-relevant navigation', () => {
  const groups = filterNavGroupsByRole(SAMPLE_NAV_GROUPS, 'fulfillment');
  const paths = extractMenuPaths(groups);

  // Allowed
  assert.ok(paths.includes('/'));
  assert.ok(paths.includes('/orders'));
  assert.ok(paths.includes('/requests'));
  assert.ok(paths.includes('/inventory'));

  // Forbidden / hidden
  assert.ok(!paths.includes('/financials'), 'Financials must be hidden from fulfillment');
  assert.ok(!paths.includes('/analytics'), 'Analytics must be hidden from fulfillment');
  assert.ok(!paths.includes('/settings'), 'Settings must be hidden from fulfillment');
  assert.ok(!paths.includes('/settings/admins'), 'Admin accounts must be hidden from fulfillment');
  assert.ok(!paths.includes('/coupons'), 'Coupons must be hidden from fulfillment');
  assert.ok(!paths.includes('/newsletter/compose'), 'Newsletter must be hidden from fulfillment');

  // Customize & Newsletter groups should be completely pruned
  assert.ok(!groups.some(g => g.label === 'Newsletter'));
  assert.ok(!groups.some(g => g.label === 'Customize'));
});

test('support role sees only support-relevant navigation', () => {
  const groups = filterNavGroupsByRole(SAMPLE_NAV_GROUPS, 'support');
  const paths = extractMenuPaths(groups);

  // Allowed
  assert.ok(paths.includes('/'));
  assert.ok(paths.includes('/orders'));
  assert.ok(paths.includes('/requests'));
  assert.ok(paths.includes('/customers'));
  assert.ok(paths.includes('/reviews'));

  // Forbidden / hidden
  assert.ok(!paths.includes('/financials'), 'Financials must be hidden from support');
  assert.ok(!paths.includes('/inventory'), 'Inventory must be hidden from support');
  assert.ok(!paths.includes('/settings/admins'), 'Admin accounts must be hidden from support');
  assert.ok(!paths.includes('/coupons'), 'Coupons must be hidden from support');
});

test('marketing role sees only marketing-relevant navigation', () => {
  const groups = filterNavGroupsByRole(SAMPLE_NAV_GROUPS, 'marketing');
  const paths = extractMenuPaths(groups);

  // Allowed
  assert.ok(paths.includes('/'));
  assert.ok(paths.includes('/analytics'));
  assert.ok(paths.includes('/products'));
  assert.ok(paths.includes('/coupons'));
  assert.ok(paths.includes('/promotions'));
  assert.ok(paths.includes('/reviews'));
  assert.ok(paths.includes('/newsletter/compose'));

  // Forbidden / hidden
  assert.ok(!paths.includes('/orders'), 'Orders must be hidden from marketing');
  assert.ok(!paths.includes('/requests'), 'Requests must be hidden from marketing');
  assert.ok(!paths.includes('/inventory'), 'Inventory must be hidden from marketing');
  assert.ok(!paths.includes('/financials'), 'Financials must be hidden from marketing');
  assert.ok(!paths.includes('/settings/admins'), 'Admin accounts must be hidden from marketing');
});

test('unauthenticated or unknown role returns empty nav groups', () => {
  assert.deepStrictEqual(filterNavGroupsByRole(SAMPLE_NAV_GROUPS, null), []);
  assert.deepStrictEqual(filterNavGroupsByRole(SAMPLE_NAV_GROUPS, undefined), []);
  assert.deepStrictEqual(filterNavGroupsByRole(SAMPLE_NAV_GROUPS, 'guest'), []);
});

test('isRouteAllowed enforces prefix and exact matching', () => {
  assert.strictEqual(isRouteAllowed('/orders/abc-123', 'fulfillment'), true);
  assert.strictEqual(isRouteAllowed('/orders/abc-123', 'support'), true);
  assert.strictEqual(isRouteAllowed('/orders/abc-123', 'marketing'), false);

  assert.strictEqual(isRouteAllowed('/financials', 'support'), false);
  assert.strictEqual(isRouteAllowed('/settings/admins', 'fulfillment'), false);
  assert.strictEqual(isRouteAllowed('/settings/admins', 'admin'), true);
  assert.strictEqual(isRouteAllowed('/settings/admins', 'super_admin'), true);
});
