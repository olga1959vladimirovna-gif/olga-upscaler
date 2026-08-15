import { handleUpload } from '@vercel/blob/client';

export default async function handler(request, response) {
  const body = request.body;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'],
          addRandomSuffix: true,
          maximumSizeInBytes: 500 * 1024 * 1024,
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('blob upload completed', blob.url);
      },
    });
    return response.status(200).json(jsonResponse);
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
}
