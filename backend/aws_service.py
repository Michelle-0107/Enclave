import os
import boto3
from dotenv import load_dotenv

load_dotenv()

# initialize AWS clients
s3_client = boto3.client(
    "s3",
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name=os.getenv("AWS_REGION", "us-east-1"),
)

bedrock_client = boto3.client(
    "bedrock-runtime",
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name=os.getenv("AWS_REGION", "us-east-1"),
)

BUCKET_NAME = os.getenv("S3_BUCKET_NAME")



# 1. upload image to S3
def upload_image_to_s3(file_bytes, file_name, content_type):
  try:
    s3_client.put_object(
        Bucket=BUCKET_NAME,
        Key=file_name,
        Body=file_bytes,
        ContentType=content_type,
    )
    # generate image access URL
    file_url = (
        f"https://{BUCKET_NAME}.s3.amazonaws.com/{file_name}"  # or return the path as needed
    )
    return file_url
  except Exception as e:
    print(f"S3 Upload Error: {e}")
    return None


# 2. call Amazon Nova Lite model to analyze community issues
def analyze_report_with_nova(description: str):
  import json

  model_id = "amazon.nova-lite-v1:0"

  # Nova model's standard request body format
  payload = {
      "messages": [{
          "role": "user",
          "content": [{
              "text": (
                  "You are a community issue management assistant. Please classify the following resident-submitted issue description, "
                  "and provide a severity level (high/medium/low).\nDescription: "
                  f"{description}"
              )
          }],
      }],
      "inferenceConfig": {"max_new_tokens": 300, "temperature": 0.2},
  }

  try:
    response = bedrock_client.invoke_model(
        modelId=model_id,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(payload),
    )
    result = json.loads(response["body"].read())
    # analyze Nova returned text
    answer = (
        result.get("output", {})
        .get("message", {})
        .get("content", [{}])[0]
        .get("text", "")
    )
    return answer
  except Exception as e:
    print(f"Bedrock Invoke Error: {e}")
    return (
        "AI is currently verifying or temporarily unavailable, text has been recorded. Error: " + str(e)
    )  # even if Bedrock throws an error, it can gracefully degrade