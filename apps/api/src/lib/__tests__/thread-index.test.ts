import { describe, expect, it } from 'vitest'
import { leadsWithSignalId } from '../thread-index'

describe('the thread report index check', () => {
  it('finds an index that leads with signal_id', () => {
    expect(leadsWithSignalId('CREATE INDEX idx_ets_signal_id ON public.event_thread_signals USING btree (signal_id)')).toBe(true)
    expect(leadsWithSignalId('CREATE INDEX event_thread_signals_signal_id_index ON public.event_thread_signals USING btree (signal_id, thread_id)')).toBe(true)
  })
  it('does not count one that starts with the thread', () => {
    expect(leadsWithSignalId('CREATE UNIQUE INDEX event_thread_signals_pkey ON public.event_thread_signals USING btree (thread_id, signal_id)')).toBe(false)
  })
})
