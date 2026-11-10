import { describe, expect, it, vi } from 'vitest';
import { FlagsService } from '../../src/flags/flags.service.js';
import { DeedDebounceService } from '../../src/near/deed/deed-debounce.service.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import { DeedSettledService } from '../../src/near/deed/deed-settled.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';
import type { NotifierPort } from '../../src/ports/notifier.port.js';

function buildSettledHarness(waves: string, notifier: NotifierPort) {
  const flags = new FlagsService({ TA_WAVES: waves } as never);
  const deeds = new DeedRepository();
  const mint = new DeedMintOutboxService(flags, deeds);
  const proj = new DeedProjectorService(flags, deeds);
  const deb = new DeedDebounceService(flags, deeds, proj, mint);
  const settled = new DeedSettledService(
    flags,
    deeds,
    proj,
    deb,
    mint,
    undefined,
    undefined,
    undefined,
    notifier,
  );
  deb.onModuleInit();
  return { mint, proj, settled };
}

describe('W20-25 NotifierPort integration on DeedSettledService (unit)', () => {
  it('calls NotifierPort ONLY on deed settled when W09 is enabled, and never errors when W09 is off', async () => {
    const sendSpy = vi.fn(async () => ({ id: 'notif_1', status: 'sent' as const }));
    const notifier: NotifierPort = { send: sendSpy };

    const noW09 = buildSettledHarness('W05,W08,W20', notifier);
    await noW09.mint.mintForColony({
      colonyId: 'col_0',
      planetId: 'planet_w20',
      colonyName: 'Aegis',
      planetType: 'temperate',
      stage: 4,
      terraformBp: 4000,
    });
    await noW09.proj.projectMilestone({
      colonyId: 'col_0',
      planetId: 'planet_w20',
      terraformBp: 5000,
      change: 'Terraform 50 %',
    });
    await noW09.settled.settleColonyDeed({ colonyId: 'col_0', planetId: 'planet_w20' });
    expect(sendSpy).not.toHaveBeenCalled();

    const withW09 = buildSettledHarness('W05,W08,W09,W20', notifier);
    await withW09.mint.mintForColony({
      colonyId: 'col_1',
      planetId: 'planet_w20',
      colonyName: 'Helios',
      planetType: 'temperate',
      stage: 4,
      terraformBp: 4000,
    });
    await withW09.proj.projectMilestone({
      colonyId: 'col_1',
      planetId: 'planet_w20',
      terraformBp: 5000,
      change: 'Terraform 50 %',
      forceImmediate: true,
    });
    expect(sendSpy).not.toHaveBeenCalled();

    await withW09.settled.settleColonyDeed({ colonyId: 'col_1', planetId: 'planet_w20' });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        colonyId: 'col_1',
        eventId: 'deed-settled:col_1',
        kind: 'deed_settled',
        channel: 'telegram',
        title: 'Colony Deed Settled',
      }),
    );
  });
});
