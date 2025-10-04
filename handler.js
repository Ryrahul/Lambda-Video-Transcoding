import { MediaConvertClient, CreateJobCommand } from "@aws-sdk/client-mediaconvert";
import fetch from "node-fetch";
import path from "path";


function getMediaConvertClient() {
  return new MediaConvertClient({
    region: process.env.AWS_REGION || "ap-southeast-2",
  });
}

export const transcodeOnUpload = async (event) => {
  console.log("Received S3 event:", JSON.stringify(event, null, 2));
  const mc = getMediaConvertClient();

  for (const rec of event.Records) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));
    if (!key.endsWith(".mp4")) continue;

    const base = path.parse(key).name;
    const outPrefix = `processed/${base}/`;
    const dest = `s3://${bucket}/${outPrefix}`;

    const params = {
      Role: process.env.MEDIACONVERT_ROLE_ARN,
      Settings: {
        Inputs: [
          {
            FileInput: `s3://${bucket}/${key}`,
            AudioSelectors: {
              "Audio Selector 1": { DefaultSelection: "DEFAULT" },
            },
            VideoSelector: {},
          },
        ],
        OutputGroups: [
          {
            Name: "HLS Group",
            OutputGroupSettings: {
              Type: "HLS_GROUP_SETTINGS",
              HlsGroupSettings: {
                Destination: dest,
                SegmentLength: 6,
                MinSegmentLength: 0,
                ManifestDurationFormat: "INTEGER",
                OutputSelection: "MANIFESTS_AND_SEGMENTS",
                DirectoryStructure: "SINGLE_DIRECTORY",
                ManifestCompression: "NONE",
                ManifestEncoding: "UTF8",
              },
            },
            Outputs: [
              {
                NameModifier: "_hls", // required property
                ContainerSettings: {
                  Container: "M3U8",
                },
                VideoDescription: {
                  CodecSettings: {
                    Codec: "H_264",
                    H264Settings: {
                      RateControlMode: "QVBR",
                      SceneChangeDetect: "TRANSITION_DETECTION",
                      MaxBitrate: 5000000,
                      QvbrQualityLevel: 8,
                      CodecProfile: "MAIN",
                      FramerateControl: "INITIALIZE_FROM_SOURCE",
                      GopSize: 90,
                      GopBReference: "ENABLED",
                      AdaptiveQuantization: "HIGH",
                      EntropyEncoding: "CABAC",
                      NumberBFramesBetweenReferenceFrames: 2,
                      InterlaceMode: "PROGRESSIVE",
                      ParControl: "INITIALIZE_FROM_SOURCE",
                    },
                  },
                },
                AudioDescriptions: [
                  {
                    AudioSourceName: "Audio Selector 1",
                    CodecSettings: {
                      Codec: "AAC",
                      AacSettings: {
                        Bitrate: 96000,
                        CodingMode: "CODING_MODE_2_0",
                        SampleRate: 48000,
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      UserMetadata: {
        originalKey: key,
        outPrefix,
      },
    };

    console.log("Creating MediaConvert job for", key);
    await mc.send(new CreateJobCommand(params));
  }

  return { statusCode: 200, body: "Started MediaConvert job(s)" };
};

export const onConvertComplete = async (event) => {
  console.log("MediaConvert COMPLETE event:", JSON.stringify(event, null, 2));

  for (const rec of event.Records || [event]) {
    const detail = rec.detail || event.detail;
    if (!detail || detail.status !== "COMPLETE") continue;

    const meta = detail.userMetadata || {};
    const originalKey = meta.originalKey;
    const outPrefix = meta.outPrefix;
    const playlistPath = `${outPrefix}${process.env.PLAYLIST_NAME}`;

   const response= await fetch(`${process.env.BACKEND_URL}/api/media/transcoded`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        secret: process.env.LAMBDA_SECRET,
      },
      body: JSON.stringify({ originalKey, playlistPath }),
    });
    console.log(await response.json())
  }

  return { statusCode: 200, body: "Backend updated" };
};
