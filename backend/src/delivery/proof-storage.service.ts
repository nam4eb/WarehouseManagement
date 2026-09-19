import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

@Injectable()
export class ProofStorageService implements OnModuleInit {
  private readonly bucket = process.env.S3_BUCKET ?? 'wms-attachments';
  private readonly credentials = {
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'minio',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'change-me',
  };
  private readonly internal = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:59000',
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: this.credentials,
    forcePathStyle: true,
  });
  private readonly signer = new S3Client({
    endpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:59000',
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: this.credentials,
    forcePathStyle: true,
  });

  async onModuleInit() {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.internal.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async createUpload(
    organizationId: string,
    tripId: string,
    fileName: string,
    contentType: string,
  ) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType))
      throw new BadRequestException('POD_FILE_TYPE_NOT_ALLOWED');
    const extension = extname(fileName).toLowerCase();
    const safeExtension = ['.jpg', '.jpeg', '.png', '.webp'].includes(extension) ? extension : '';
    const objectKey = `pod/${organizationId}/${tripId}/${randomUUID()}${safeExtension}`;
    const uploadUrl = await getSignedUrl(
      this.signer,
      new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, ContentType: contentType }),
      { expiresIn: 300 },
    );
    return { objectKey, uploadUrl, expiresIn: 300 };
  }

  async assertObjects(organizationId: string, tripId: string, objectKeys: string[]) {
    const prefix = `pod/${organizationId}/${tripId}/`;
    if (objectKeys.some((key) => !key.startsWith(prefix)))
      throw new BadRequestException('POD_OBJECT_OUTSIDE_SCOPE');
    try {
      await Promise.all(
        objectKeys.map((Key) =>
          this.internal.send(new HeadObjectCommand({ Bucket: this.bucket, Key })),
        ),
      );
    } catch {
      throw new BadRequestException('POD_OBJECT_NOT_FOUND');
    }
  }
}
