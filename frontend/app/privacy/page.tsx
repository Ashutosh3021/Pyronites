import Link from 'next/link'
import { CoreMark } from '@/components/brand'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background grid grid-cols-1 lg:grid-cols-12">
      <aside className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-seam px-6 sm:px-10 lg:px-12 py-10 lg:py-14">
        <div className="flex items-center gap-3">
          <CoreMark size={26} />
          <span className="wordmark text-[15px] text-ink">PyroCore</span>
        </div>
        <p className="label mt-10 lg:mt-16">Instance policies</p>
        <p className="mt-4 text-[13.5px] leading-relaxed text-ink-muted max-w-[38ch]">
          These pages describe the instance you are connected to. The operator of a self-hosted
          PyroCore instance is whoever deployed it.
        </p>
      </aside>

      <main id="main" className="lg:col-span-7 px-6 sm:px-10 lg:px-14 py-10 lg:py-14">
        <h1 className="display text-[clamp(2rem,1.3rem+2.4vw,3.25rem)]">Privacy policy</h1>
        <div className="mt-8 space-y-5 max-w-[62ch]">
          <p className="text-[14px] leading-relaxed text-ink-muted">
            This is a self-hosted PyroCore instance. Data you submit (account credentials, database
            contents, uploaded files) is stored by the instance operator. PyroCore does not transmit
            your data to third parties except the object storage provider you configure, if any.
          </p>
          <p className="text-[14px] leading-relaxed text-ink-muted">
            No formal privacy policy has been configured yet. Contact the instance administrator
            with any questions.
          </p>
        </div>
        <Link href="/" className="link mt-10 inline-block text-[13px]">
          Back to PyroCore
        </Link>
      </main>
    </div>
  )
}
