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

# 연습용 S3 버킷
resource "aws_s3_bucket" "practice" {
    bucket = "zunfa-terraform-practice-2026"

    tags = {
        Project   = "hybrid-cloud-portfolio"
        ManagedBy = "Terraform"
    }
}