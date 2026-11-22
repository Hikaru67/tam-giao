import { ACCOUNT_DELETION_REQUESTED } from '@tamgiao/contracts';
import { registerUploadErasureConsumer, type EventBus } from '@tamgiao/db';
import type { Clock, Encryptor, ObjectStorage } from '@tamgiao/kernel';
import {
  createBillingPersonalDataSource,
  registerBillingAccountDeletionConsumer,
} from '@tamgiao/module-billing';
import type { PersonalDataSource } from '@tamgiao/module-identity';
import { createMatchingPersonalDataSource } from '@tamgiao/module-matching';
import { createMessagingPersonalDataSource } from '@tamgiao/module-messaging';
import { registerNotificationAccountDeletionConsumer } from '@tamgiao/module-notification';
import {
  createProfilePersonalDataSource,
  registerProfileAccountDeletionConsumer,
} from '@tamgiao/module-profile';
import {
  createSafetyPersonalDataSource,
  registerSafetyAccountDeletionConsumer,
} from '@tamgiao/module-safety';
import {
  createVerificationPersonalDataSource,
  registerVerificationAccountDeletionConsumer,
} from '@tamgiao/module-verification';

export interface DataRightsDeps {
  readonly clock: Clock;
  readonly encryptor: Encryptor;
  readonly storage: ObjectStorage;
}

/**
 * Consumer `AccountDeletionRequested` (BE-S7-06) của các module không có `createXWorker` riêng: profile, verification,
 * billing, safety, notification, uploads. Matching và messaging đăng ký trong `createMatchingWorker` / `createMessagingWorker`.
 */
export function registerAccountDeletionConsumers(bus: EventBus, deps: DataRightsDeps): void {
  registerProfileAccountDeletionConsumer(bus, { storage: deps.storage });
  registerVerificationAccountDeletionConsumer(bus, { storage: deps.storage, clock: deps.clock });
  registerBillingAccountDeletionConsumer(bus, { clock: deps.clock });
  registerSafetyAccountDeletionConsumer(bus, { storage: deps.storage });
  registerNotificationAccountDeletionConsumer(bus, { clock: deps.clock });
  registerUploadErasureConsumer(bus, { eventType: ACCOUNT_DELETION_REQUESTED, storage: deps.storage });
}

/** Nguồn dữ liệu của các module cho file xuất (mục `account` do identity tự thêm). */
export function personalDataSources(deps: Pick<DataRightsDeps, 'encryptor'>): readonly PersonalDataSource[] {
  return [
    createProfilePersonalDataSource(deps.encryptor),
    createVerificationPersonalDataSource(deps.encryptor),
    createBillingPersonalDataSource(),
    createMatchingPersonalDataSource(),
    createMessagingPersonalDataSource(),
    createSafetyPersonalDataSource(),
  ];
}
