import { notFound } from 'next/navigation'
import { profileStatus } from '@/lib/profile-exists'

/** world-pulse.io/<handle>: a real 404 when no account has that handle (lib/profile-exists.ts) */
export default async function HandleLayout(
  { children, params }: { children: React.ReactNode; params: Promise<{ handle: string }> },
) {
  const { handle } = await params
  if (await profileStatus(handle) === 'missing') notFound()
  return children
}
