terraform {
    required_providers {
        aws = {
            source = "hashicorp/aws"
            version = "~> 5.0"
        }
    }
}

provider "aws" {
    region = "ap-northeast-2"
}

# IAM 사용자 (백업 업로드 전용)
resource "aws_iam_user" "backup" {
    name = "backup-uploader-tf"

    tags = {
        Project   = "hybrid-cloud-portfolio"
        ManagedBy = "Terraform"
    }
}

# IAM 정책 (특정 버킷 업로드 권한 only)
resource "aws_iam_policy" "backup" {
    name        = "s3-backup-policy-tf"
    description = "백업 버킷에 대한 최소 권한(업로드/조회/삭제)"

    policy = jsonencode({
        Version = "2012-10-17"
        Statement = [
            {
                Sid    = "ObjectActions"
                Effect = "Allow"
                Action = [
                    "s3:PutObject",
                    "s3:GetObject",
                    "s3:DeleteObject"
                ]
                Resource = "arn:aws:s3:::zunfa-portfolio-backups-2026/*"
            }
        ]
    })   
}

# 정책을 사용자에 연결
resource "aws_iam_user_policy_attachment" "backup" {
    user       = aws_iam_user.backup.name
    policy_arn = aws_iam_policy.backup.arn
}