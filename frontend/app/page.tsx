'use client'

import { PyroCoreLayout } from '@/components/pyrocore-layout'
import { Database, Brackets, Archive, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export default function OverviewPage() {
  return (
    <PyroCoreLayout>
      <div className="max-w-6xl space-y-6 lg:space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground mb-2">
            Project Overview
          </h1>
          <p className="text-muted-foreground text-sm">
            Status and quick access to your backend infrastructure
          </p>
        </div>

        {/* Status Cards
            Mobile:  1 column
            Tablet:  2 columns
            Desktop: 3 columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">

          {/* Database Card */}
          <div className="bg-card border border-border p-5 lg:p-6 hover:border-accent/30 transition-colors">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground">Database</h3>
              <Database className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--pyro-orange)' }} />
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">File Size</p>
                <p className="text-lg font-semibold text-foreground">4.2 GB</p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Tables</p>
                  <p className="text-foreground font-medium">12</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Mode</p>
                  <p className="text-foreground font-medium">WAL</p>
                </div>
              </div>
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">Last backup: 2 hours ago</p>
              </div>
            </div>
          </div>

          {/* API Card */}
          <div className="bg-card border border-border p-5 lg:p-6 hover:border-accent/30 transition-colors">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground">API</h3>
              <Brackets className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--pyro-orange)' }} />
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Requests (24h)</p>
                <p className="text-lg font-semibold text-foreground">1,247</p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground">API Keys</p>
                  <p className="text-foreground font-medium">3</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Uptime</p>
                  <p className="text-foreground font-medium">99.9%</p>
                </div>
              </div>
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">Last request: 2 min ago</p>
              </div>
            </div>
          </div>

          {/* Storage Card — full-width on mobile when 2-col (sm breakpoint makes it span 2) */}
          <div className="bg-card border border-border p-5 lg:p-6 hover:border-accent/30 transition-colors sm:col-span-2 lg:col-span-1">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-sm font-medium text-foreground">Storage</h3>
              <Archive className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--pyro-orange)' }} />
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Total Used</p>
                <p className="text-lg font-semibold text-foreground">18.5 GB</p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-muted-foreground">Files</p>
                  <p className="text-foreground font-medium">47</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Location</p>
                  <p className="text-foreground font-medium">Local</p>
                </div>
              </div>
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">Limit: 100 GB</p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div>
          <h2 className="text-base lg:text-lg font-semibold text-foreground mb-4">Recent Activity</h2>
          <div className="bg-card border border-border divide-y divide-border">
            {[
              { time: '14:32', action: 'Table `posts` created', type: 'creation' },
              { time: '13:15', action: 'Backup completed', type: 'completion' },
              { time: '12:48', action: 'API key revoked', type: 'failure' },
              { time: '10:22', action: 'User session created', type: 'creation' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-center hover:bg-muted/30 transition-colors overflow-hidden min-h-[52px]">
                {/* Left-edge color marker */}
                <div
                  className="w-1 self-stretch flex-shrink-0"
                  style={{
                    backgroundColor:
                      item.type === 'creation'   ? 'var(--pyro-orange)'
                    : item.type === 'completion' ? 'var(--success)'
                    : 'var(--error)',
                  }}
                />
                <div className="flex items-center gap-3 lg:gap-4 px-4 lg:px-5 py-3 flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground font-mono w-10 lg:w-12 flex-shrink-0">{item.time}</p>
                  <p className="text-sm text-foreground truncate">{item.action}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions
            Mobile:  2 columns
            Desktop: 4 columns */}
        <div>
          <h2 className="text-base lg:text-lg font-semibold text-foreground mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'New Table', href: '/database' },
              { label: 'Run Backup', href: '/settings' },
              { label: 'Create API Key', href: '/api-keys' },
              { label: 'View Logs', href: '/logs' },
            ].map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="btn-primary flex items-center justify-center gap-2 text-center min-h-[44px]"
              >
                <span>{action.label}</span>
                <ArrowRight className="w-3 h-3 flex-shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </PyroCoreLayout>
  )
}
