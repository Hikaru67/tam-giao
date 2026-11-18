import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3ObjectStorage, type S3ObjectStorageConfig } from '../s3-object-storage.js';
import { createBuckets, startSeaweedFs } from './seaweedfs-container.js';

describe('S3ObjectStorage Integration Tests', () => {
  let stopContainer: (() => Promise<void>) | undefined;
  let storage: S3ObjectStorage;
  let config: S3ObjectStorageConfig;
  const fixedNow = new Date('2026-11-18T10:00:00.000Z');

  beforeAll(async () => {
    const seaweedFs = await startSeaweedFs();
    stopContainer = seaweedFs.stop;
    await createBuckets(seaweedFs.endpoint, ['test-public', 'test-private']);

    config = {
      endpoint: seaweedFs.endpoint,
      region: 'us-east-1',
      accessKeyId: seaweedFs.accessKeyId,
      secretAccessKey: seaweedFs.secretAccessKey,
      forcePathStyle: true,
      buckets: {
        publicProfile: 'test-public',
        privateKyc: 'test-private',
      },
      presignGetTtlSeconds: 300,
    };

    storage = new S3ObjectStorage(config, () => fixedNow);
  }, 120_000);

  afterAll(async () => {
    if (stopContainer) {
      await stopContainer();
    }
  });

  it('presignPut allows upload via fetch and head returns correct sizeBytes and contentType', async () => {
    const body = Buffer.from('png-file-content-sample');
    const key = 'profile-photos/user-1.png';

    const presigned = await storage.presignPut({
      bucket: 'publicProfile',
      key,
      contentType: 'image/png',
      sizeBytes: body.length,
      expiresInSeconds: 60,
    });

    const response = await fetch(presigned.url, {
      method: 'PUT',
      headers: {
        ...presigned.headers,
      },
      body,
    });

    expect(response.status).toBe(200);

    const headResult = await storage.head('publicProfile', key);
    expect(headResult).toEqual({
      sizeBytes: body.length,
      contentType: 'image/png',
    });
  });

  it('rejects upload when body is longer than signed sizeBytes and head returns null', async () => {
    const declaredSize = 8;
    const body = Buffer.from('longer body than declared');
    const key = 'profile-photos/too-long.png';

    const presigned = await storage.presignPut({
      bucket: 'publicProfile',
      key,
      contentType: 'image/png',
      sizeBytes: declaredSize,
      expiresInSeconds: 60,
    });

    const response = await fetch(presigned.url, {
      method: 'PUT',
      headers: {
        ...presigned.headers,
      },
      body,
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);

    const headResult = await storage.head('publicProfile', key);
    expect(headResult).toBeNull();
  });

  it('rejects upload when sending image/jpeg for signed image/png content-type', async () => {
    const body = Buffer.from('mismatched-content-type-payload');
    const key = 'profile-photos/wrong-content-type.png';

    const presigned = await storage.presignPut({
      bucket: 'publicProfile',
      key,
      contentType: 'image/png',
      sizeBytes: body.length,
      expiresInSeconds: 60,
    });

    const response = await fetch(presigned.url, {
      method: 'PUT',
      headers: {
        'content-type': 'image/jpeg',
      },
      body,
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);

    const headResult = await storage.head('publicProfile', key);
    expect(headResult).toBeNull();
  });

  it('presignGet returns correct bytes after upload and expiresAt is now plus 300s', async () => {
    const body = Buffer.from('confidential-kyc-document-content');
    const key = 'kyc-documents/passport.pdf';

    const presignedPut = await storage.presignPut({
      bucket: 'privateKyc',
      key,
      contentType: 'application/pdf',
      sizeBytes: body.length,
      expiresInSeconds: 60,
    });

    const putResponse = await fetch(presignedPut.url, {
      method: 'PUT',
      headers: {
        ...presignedPut.headers,
      },
      body,
    });
    expect(putResponse.status).toBe(200);

    const customNow = new Date('2026-11-18T15:30:00.000Z');
    const storageWithCustomNow = new S3ObjectStorage(config, () => customNow);

    const presignedGet = await storageWithCustomNow.presignGet({
      bucket: 'privateKyc',
      key,
    });

    expect(presignedGet.method).toBe('GET');
    expect(presignedGet.headers).toEqual({});
    expect(presignedGet.expiresAt).toEqual(new Date(customNow.getTime() + 300 * 1000));

    const getResponse = await fetch(presignedGet.url);
    expect(getResponse.status).toBe(200);

    const arrayBuffer = await getResponse.arrayBuffer();
    expect(Buffer.from(arrayBuffer)).toEqual(body);
  });

  it('returns null for non-existent head, allows idempotent delete, and deletes uploaded object', async () => {
    const missingKey = 'missing-object-key.txt';

    const nonExistentHead = await storage.head('publicProfile', missingKey);
    expect(nonExistentHead).toBeNull();

    await expect(storage.delete('publicProfile', missingKey)).resolves.toBeUndefined();

    const body = Buffer.from('ephemeral-file-content');
    const key = 'temporary/ephemeral.txt';

    const presignedPut = await storage.presignPut({
      bucket: 'publicProfile',
      key,
      contentType: 'text/plain',
      sizeBytes: body.length,
      expiresInSeconds: 60,
    });

    const putResponse = await fetch(presignedPut.url, {
      method: 'PUT',
      headers: {
        ...presignedPut.headers,
      },
      body,
    });
    expect(putResponse.status).toBe(200);

    const beforeDelete = await storage.head('publicProfile', key);
    expect(beforeDelete).not.toBeNull();

    await storage.delete('publicProfile', key);

    const afterDelete = await storage.head('publicProfile', key);
    expect(afterDelete).toBeNull();
  });

  it('maps publicProfile and privateKyc to correct physical buckets', async () => {
    const body = Buffer.from('private-bucket-only-data');
    const commonKey = 'same-key-in-different-buckets.txt';

    const presignedPut = await storage.presignPut({
      bucket: 'privateKyc',
      key: commonKey,
      contentType: 'text/plain',
      sizeBytes: body.length,
      expiresInSeconds: 60,
    });

    const putResponse = await fetch(presignedPut.url, {
      method: 'PUT',
      headers: {
        ...presignedPut.headers,
      },
      body,
    });
    expect(putResponse.status).toBe(200);

    const privateHead = await storage.head('privateKyc', commonKey);
    expect(privateHead).toEqual({
      sizeBytes: body.length,
      contentType: 'text/plain',
    });

    const publicHead = await storage.head('publicProfile', commonKey);
    expect(publicHead).toBeNull();
  });
});
