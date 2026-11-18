import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectHead, ObjectStorage, PresignedRequest, StorageBucket } from '@tamgiao/kernel';

/** Cấu hình kết nối cho S3 / SeaweedFS object storage */
export interface S3ObjectStorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  buckets: {
    publicProfile: string;
    privateKyc: string;
  };
  presignGetTtlSeconds: number;
}

/**
 * Adapter hiện thực port ObjectStorage dùng AWS S3 SDK v3.
 * Hỗ trợ tạo presigned PUT / GET URL và tương tác trực tiếp với S3 / SeaweedFS.
 */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly config: S3ObjectStorageConfig;
  private readonly now: () => Date;

  constructor(config: S3ObjectStorageConfig, now: () => Date = () => new Date()) {
    this.config = config;
    this.now = now;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    });
  }

  /**
   * Tạo presigned URL cho client upload (PUT).
   * Ký cả `content-type` và `content-length` để client không thể thay đổi loại hoặc kích thước file.
   */
  async presignPut(input: {
    readonly bucket: StorageBucket;
    readonly key: string;
    readonly contentType: string;
    readonly sizeBytes: number;
    readonly expiresInSeconds: number;
  }): Promise<PresignedRequest> {
    const command = new PutObjectCommand({
      Bucket: this.resolveBucket(input.bucket),
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
    });

    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });

    const expiresAt = new Date(this.now().getTime() + input.expiresInSeconds * 1000);

    return {
      url,
      method: 'PUT',
      headers: {
        'content-type': input.contentType,
      },
      expiresAt,
    };
  }

  /**
   * Tạo presigned URL cho client tải về (GET).
   * Hạn dùng cố định theo config.presignGetTtlSeconds.
   */
  async presignGet(input: {
    readonly bucket: StorageBucket;
    readonly key: string;
  }): Promise<PresignedRequest> {
    const command = new GetObjectCommand({
      Bucket: this.resolveBucket(input.bucket),
      Key: input.key,
    });

    const expiresIn = this.config.presignGetTtlSeconds;
    const url = await getSignedUrl(this.client, command, { expiresIn });
    const expiresAt = new Date(this.now().getTime() + expiresIn * 1000);

    return {
      url,
      method: 'GET',
      headers: {},
      expiresAt,
    };
  }

  /**
   * Lấy thông tin kích thước và loại MIME của object.
   * Trả về null nếu object không tồn tại (lỗi NotFound hoặc status 404).
   */
  async head(bucket: StorageBucket, key: string): Promise<ObjectHead | null> {
    const command = new HeadObjectCommand({
      Bucket: this.resolveBucket(bucket),
      Key: key,
    });

    try {
      const response = await this.client.send(command);
      return {
        sizeBytes: response.ContentLength ?? 0,
        contentType: response.ContentType ?? null,
      };
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Xoá object khỏi bucket. Thao tác này là idempotent: object không tồn tại cũng không ném lỗi.
   */
  async delete(bucket: StorageBucket, key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.resolveBucket(bucket),
      Key: key,
    });

    await this.client.send(command);
  }

  /**
   * Ánh xạ tên bucket logic (publicProfile, privateKyc) sang tên bucket vật lý trong S3.
   */
  private resolveBucket(bucket: StorageBucket): string {
    return this.config.buckets[bucket];
  }

  /**
   * Kiểm tra lỗi có phải do object không tồn tại (404 Not Found) hay không.
   */
  private isNotFoundError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    if ('name' in error && (error.name === 'NotFound' || error.name === 'NoSuchKey')) {
      return true;
    }
    if (
      '$metadata' in error &&
      typeof error.$metadata === 'object' &&
      error.$metadata !== null &&
      'httpStatusCode' in error.$metadata &&
      error.$metadata.httpStatusCode === 404
    ) {
      return true;
    }
    return false;
  }
}
