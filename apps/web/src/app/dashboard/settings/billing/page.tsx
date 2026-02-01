'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface BillingInfo {
  tier: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  hasPaymentMethod: boolean;
}

interface UsageInfo {
  currentPeriod: {
    start: string;
    end: string;
  };
  usage: {
    repositories: number;
    generations: number;
    tokensUsed: number;
  };
  limits: {
    maxRepositories: number;
    maxGenerationsPerMonth: number;
  };
}

interface Invoice {
  id: string;
  amount: number;
  status: string;
  date: string;
  url: string;
}

const TIER_INFO: Record<string, { name: string; price: string; features: string[] }> = {
  free: {
    name: 'Free',
    price: '$0/month',
    features: [
      '3 repositories',
      '50 generations/month',
      'Basic doc types',
      'Community support',
    ],
  },
  pro: {
    name: 'Pro',
    price: '$10/month',
    features: [
      '10 repositories',
      '500 generations/month',
      'All doc types',
      'Priority support',
      'Style learning',
    ],
  },
  team: {
    name: 'Team',
    price: '$30/month',
    features: [
      '50 repositories',
      '2000 generations/month',
      'All doc types',
      'Team management',
      'SSO',
      'Audit logs',
    ],
  },
  enterprise: {
    name: 'Enterprise',
    price: 'Contact us',
    features: [
      'Unlimited repositories',
      'Unlimited generations',
      'Custom integrations',
      'Dedicated support',
      'SLA',
      'On-premise option',
    ],
  },
};

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    fetchBillingData();
  }, []);

  async function fetchBillingData() {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    try {
      const [billingRes, usageRes, invoicesRes] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/billing`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/billing/usage`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/billing/invoices`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const [billingData, usageData, invoicesData] = await Promise.all([
        billingRes.json(),
        usageRes.json(),
        invoicesRes.json(),
      ]);

      if (billingData.success) setBilling(billingData.data);
      if (usageData.success) setUsage(usageData.data);
      if (invoicesData.success) setInvoices(invoicesData.data);
    } catch (error) {
      console.error('Failed to fetch billing data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpgrade(tier: string) {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    setUpgrading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/billing/checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ tier }),
        }
      );
      const data = await response.json();

      if (data.success && data.data.url) {
        window.location.href = data.data.url;
      }
    } catch (error) {
      console.error('Failed to start checkout:', error);
    } finally {
      setUpgrading(false);
    }
  }

  async function handleManageBilling() {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/billing/portal`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await response.json();

      if (data.success && data.data.url) {
        window.open(data.data.url, '_blank');
      }
    } catch (error) {
      console.error('Failed to open billing portal:', error);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const currentTier = billing?.tier ?? 'free';
  const tierInfo = TIER_INFO[currentTier] ?? TIER_INFO.free;

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/dashboard/settings"
          className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        >
          ← Settings
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-8">Billing & Subscription</h1>

      {/* Current Plan */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-8">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-semibold mb-2">Current Plan</h2>
            <div className="flex items-center gap-3 mb-2">
              <span
                className={`px-3 py-1 text-sm font-medium rounded-full ${
                  currentTier === 'enterprise'
                    ? 'bg-purple-100 text-purple-800'
                    : currentTier === 'team'
                      ? 'bg-blue-100 text-blue-800'
                      : currentTier === 'pro'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                }`}
              >
                {tierInfo.name}
              </span>
              <span className="text-gray-500">{tierInfo.price}</span>
            </div>
            {billing?.currentPeriodEnd && (
              <p className="text-sm text-gray-500">
                Current period ends: {new Date(billing.currentPeriodEnd).toLocaleDateString()}
              </p>
            )}
          </div>
          {billing?.hasPaymentMethod && (
            <button
              onClick={handleManageBilling}
              className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Manage Billing
            </button>
          )}
        </div>

        {/* Features */}
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
            Included features:
          </p>
          <ul className="grid grid-cols-2 gap-2">
            {tierInfo.features.map((feature, i) => (
              <li key={i} className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                <span className="text-green-500 mr-2">✓</span>
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Usage */}
      {usage && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Current Usage</h2>

          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-sm text-gray-500 mb-1">Repositories</p>
              <p className="text-2xl font-bold">
                {usage.usage.repositories}
                <span className="text-sm font-normal text-gray-500">
                  {usage.limits.maxRepositories === -1
                    ? ' / ∞'
                    : ` / ${usage.limits.maxRepositories}`}
                </span>
              </p>
              <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600"
                  style={{
                    width:
                      usage.limits.maxRepositories === -1
                        ? '0%'
                        : `${Math.min(100, (usage.usage.repositories / usage.limits.maxRepositories) * 100)}%`,
                  }}
                />
              </div>
            </div>

            <div>
              <p className="text-sm text-gray-500 mb-1">Generations this month</p>
              <p className="text-2xl font-bold">
                {usage.usage.generations}
                <span className="text-sm font-normal text-gray-500">
                  {usage.limits.maxGenerationsPerMonth === -1
                    ? ' / ∞'
                    : ` / ${usage.limits.maxGenerationsPerMonth}`}
                </span>
              </p>
              <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-600"
                  style={{
                    width:
                      usage.limits.maxGenerationsPerMonth === -1
                        ? '0%'
                        : `${Math.min(100, (usage.usage.generations / usage.limits.maxGenerationsPerMonth) * 100)}%`,
                  }}
                />
              </div>
            </div>

            <div>
              <p className="text-sm text-gray-500 mb-1">Tokens used</p>
              <p className="text-2xl font-bold">{usage.usage.tokensUsed.toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade Options */}
      {currentTier !== 'enterprise' && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Upgrade Your Plan</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(TIER_INFO)
              .filter(([key]) => key !== 'free' && key !== currentTier)
              .map(([key, info]) => (
                <div
                  key={key}
                  className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6"
                >
                  <h3 className="text-lg font-semibold mb-1">{info.name}</h3>
                  <p className="text-2xl font-bold text-blue-600 mb-4">{info.price}</p>
                  <ul className="space-y-2 mb-6">
                    {info.features.slice(0, 4).map((feature, i) => (
                      <li key={i} className="flex items-center text-sm text-gray-600 dark:text-gray-400">
                        <span className="text-green-500 mr-2">✓</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                  {key === 'enterprise' ? (
                    <a
                      href="mailto:sales@docsynth.io"
                      className="block w-full px-4 py-2 text-center bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                    >
                      Contact Sales
                    </a>
                  ) : (
                    <button
                      onClick={() => handleUpgrade(key)}
                      disabled={upgrading}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {upgrading ? 'Processing...' : `Upgrade to ${info.name}`}
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Invoices */}
      {invoices.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold mb-4">Invoice History</h2>
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-b border-gray-200 dark:border-gray-700">
                <th className="pb-2">Date</th>
                <th className="pb-2">Amount</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="py-3">{new Date(invoice.date).toLocaleDateString()}</td>
                  <td className="py-3">${invoice.amount.toFixed(2)}</td>
                  <td className="py-3">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${
                        invoice.status === 'paid'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {invoice.status}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <a
                      href={invoice.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-sm"
                    >
                      View
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
