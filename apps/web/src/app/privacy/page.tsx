import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata } from '@/lib/page-metadata'

// The privacy policy (Nov 11, 2026): what WorldPulse keeps about the people who
// use it, in words a reader can check against the code: the web server's log (nginx/nginx.conf), the API's rate
// limit (apps/api/src/lib/rate-limit-options.ts), the AI tools' daily counts by tool (lib/outside-use.ts), the
// search words without who searched (search_analytics), the browser's own settings (wp_* in localStorage), accounts
// (users), Stripe, the email digests (Resend) and browser alerts (web_push_subscriptions). The AI directories ask
// for this page.
export const metadata: Metadata = pageMetadata({
  path: '/privacy',
  title: 'Privacy policy',
  description: 'What WorldPulse keeps about the people who use it, why, and what you can do about it: no ads, no tracking cookies, no personal data sold.',
})

/** The date at the top: change it with the policy */
export const PRIVACY_UPDATED = 'November 11, 2026'

const SECTIONS: Array<{ id: string; h: string; items: React.ReactNode[] }> = [
  {
    id: 'short',
    h: 'The short version',
    items: [
      'You can read WorldPulse, use its API and connect its AI tools without an account.',
      'We don’t show ads, we don’t sell personal data, and we don’t use advertising or tracking cookies.',
      'If you make an account, sign up for emails or turn on browser alerts, we keep only what that needs.',
    ],
  },
  {
    id: 'reading',
    h: 'When you read the site or use the API and AI tools',
    items: [
      <><strong className="text-wp-text">Server logs.</strong> Like most websites, our servers record each request: the IP address it came from, the time, the address asked for, the page that linked to it and the browser’s name. We use them to keep WorldPulse running, fix problems and stop abuse, and we count visits from them without keeping who made them. Older logs are deleted automatically as new ones come in.</>,
      <><strong className="text-wp-text">Fair use.</strong> To share the free API and AI tools fairly, we count each address’s requests for one minute at a time.</>,
      <><strong className="text-wp-text">AI tools.</strong> When an AI app such as Claude uses our tools, we answer the question it sends (a country or a topic, for example) and keep only a daily count of how often each tool was used, not who asked or what they asked.</>,
      <><strong className="text-wp-text">Searches.</strong> We keep the words typed into WorldPulse’s search and how many results they found, without who searched, to make search better.</>,
      <><strong className="text-wp-text">Your browser.</strong> The site keeps a few settings in your own browser: your theme, your alert choices and, when you sign in, your sign-in. They stay on your device.</>,
    ],
  },
  {
    id: 'account',
    h: 'When you make an account',
    items: [
      'Your email address, your handle and display name, and your password as a one-way code we can’t read back. If you sign in with GitHub or Google, we keep the account number they give us instead of a password.',
      'What you add to your profile (a bio, photo, location or website), the topics and regions you choose, what you post (posts are public), who you follow, and when you were last active.',
    ],
  },
  {
    id: 'payments',
    h: 'When you pay',
    items: [
      <>Payments are handled by Stripe. Your card details go to Stripe, not to us; we keep your Stripe customer and subscription numbers and your plan. Stripe’s own policy: <a href="https://stripe.com/privacy" className="text-wp-amber underline" rel="noopener noreferrer" target="_blank">stripe.com/privacy</a>.</>,
    ],
  },
  {
    id: 'emails',
    h: 'When you sign up for emails',
    items: [
      'Your email address, how often you want emails and on which topics. They are sent through Resend (resend.com), and every digest has a link to stop them.',
    ],
  },
  {
    id: 'alerts',
    h: 'When you turn on browser alerts',
    items: [
      'Your browser gives us an address to send alerts to and the keys to protect them, with no name or email. We keep what you asked for (breaking stories, countries) and when we last sent one. Your browser’s own alert service (Google, Mozilla or Apple) delivers them. You can turn alerts off in your browser at any time.',
    ],
  },
  {
    id: 'sharing',
    h: 'Who else sees it',
    items: [
      'Only the companies that run parts of WorldPulse for us (Stripe, Resend and our hosting provider), and anyone the law requires us to give it to. We don’t sell or rent personal data.',
    ],
  },
  {
    id: 'choices',
    h: 'What you can do',
    items: [
      <>To see, correct or delete your data, email <a href="mailto:support@world-pulse.io" className="text-wp-amber underline">support@world-pulse.io</a> from your account’s address and we’ll do it.</>,
      'Stop emails with the link in any digest. Turn off alerts in your browser.',
    ],
  },
  {
    id: 'children',
    h: 'Children',
    items: ['WorldPulse isn’t meant for children under 13, and we don’t knowingly keep their data.'],
  },
  {
    id: 'changes',
    h: 'Changes',
    items: ['If this policy changes, we’ll update this page and the date at the top.'],
  },
]

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-wp-bg text-wp-text">
      <main className="max-w-2xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-wp-text">Privacy policy</h1>
        <p className="text-xs text-wp-text3 mt-2">Last updated: {PRIVACY_UPDATED}</p>
        <p className="text-sm text-wp-text2 mt-4 mb-8 leading-relaxed">
          WorldPulse (world-pulse.io) reads the world’s news and shows which stories other newsrooms confirm. This page explains what we collect about the people who use it, why, and what you can do about it. Questions:{' '}
          <a href="mailto:support@world-pulse.io" className="text-wp-amber underline">support@world-pulse.io</a>.
        </p>
        <div className="space-y-8">
          {SECTIONS.map(s => (
            <section key={s.id} id={s.id}>
              <h2 className="text-base font-semibold text-wp-text">{s.h}</h2>
              <ul className="list-disc pl-5 mt-2 space-y-2 text-sm text-wp-text2 leading-relaxed">
                {s.items.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </section>
          ))}
        </div>
        <p className="text-sm text-wp-text2 mt-10 leading-relaxed">
          See also <Link href="/how-we-count" className="text-wp-amber underline">how we count outlets</Link>, the{' '}
          <Link href="/developers" className="text-wp-amber underline">API and AI tools</Link>, or the{' '}
          <Link href="/help" className="text-wp-amber underline">Help &amp; FAQ</Link>.
        </p>
      </main>
    </div>
  )
}
