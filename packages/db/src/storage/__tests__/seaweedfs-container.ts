import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait } from 'testcontainers';

/** Cấu hình phân quyền S3 của SeaweedFS tương đương infra/local/seaweedfs-s3.json */
const SEAWEEDFS_S3_CONFIG = JSON.stringify({
  identities: [
    {
      name: 'tamgiao-local',
      credentials: [{ accessKey: 'tamgiao', secretKey: 'tamgiao-local-secret' }],
      actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
    },
  ],
});

/**
 * Khởi động SeaweedFS container phục vụ test tích hợp giả lập S3.
 */
export async function startSeaweedFs(): Promise<{
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  stop: () => Promise<void>;
}> {
  const container = await new GenericContainer('chrislusf/seaweedfs:4.53')
    .withCommand([
      'server',
      '-dir=/data',
      '-ip.bind=0.0.0.0',
      '-master.volumeSizeLimitMB=64',
      '-volume.max=0',
      '-s3',
      '-s3.port=8333',
      '-s3.config=/etc/seaweedfs/s3.json',
    ])
    .withCopyContentToContainer([
      {
        content: SEAWEEDFS_S3_CONFIG,
        target: '/etc/seaweedfs/s3.json',
      },
    ])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forHttp('/status', 8333).forStatusCode(200))
    .withStartupTimeout(120_000)
    .start();

  const endpoint = `http://${container.getHost()}:${container.getMappedPort(8333)}`;

  return {
    endpoint,
    accessKeyId: 'tamgiao',
    secretAccessKey: 'tamgiao-local-secret',
    stop: async () => {
      await container.stop();
    },
  };
}

/**
 * Tạo danh sách bucket trên SeaweedFS S3 endpoint với cơ chế thử lại tối đa 20 lần (500ms).
 */
export async function createBuckets(endpoint: string, names: readonly string[]): Promise<void> {
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: 'tamgiao',
      secretAccessKey: 'tamgiao-local-secret',
    },
  });

  for (const name of names) {
    let created = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await client.send(new CreateBucketCommand({ Bucket: name }));
        created = true;
        break;
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          (error.name === 'BucketAlreadyOwnedByYou' || error.name === 'BucketAlreadyExists')
        ) {
          created = true;
          break;
        }
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!created) {
      throw new Error(
        `Failed to create bucket "${name}" after 20 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    }
  }
}
