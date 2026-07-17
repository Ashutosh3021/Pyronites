'use client'

import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-6 py-16 space-y-6">
        <h1 className="text-2xl font-semibold">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">
          This is a self-hosted PyroCore instance. Data you submit (account
          credentials, database contents, uploaded files) is stored by the
          instance operator. PyroCore does not transmit your data to third
          parties except the object-storage provider you configure (if any).
        </p>
        <p className="text-sm text-muted-foreground">
          No formal privacy policy has been configured yet. Contact the instance
          administrator with any questions.
        </p>
        <Link href="/" className="inline-block text-sm font-medium hover:underline" style={{ color: 'var(--pyro-orange)' }}>
          ← Back to PyroCore
        </Link>
      </div>
    </div>
  )
}
