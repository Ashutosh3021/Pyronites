'use client'

import Link from 'next/link'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-6 py-16 space-y-6">
        <h1 className="text-2xl font-semibold">Terms of Service</h1>
        <p className="text-sm text-muted-foreground">
          This is a self-hosted PyroCore instance. The operator of this server is
          responsible for its terms of use. No formal terms have been configured
          yet.
        </p>
        <p className="text-sm text-muted-foreground">
          By using this service you agree to abide by the operator&apos;s rules and
          applicable law. Contact the instance administrator for details.
        </p>
        <Link href="/" className="inline-block text-sm font-medium hover:underline" style={{ color: 'var(--pyro-orange)' }}>
          ← Back to PyroCore
        </Link>
      </div>
    </div>
  )
}
