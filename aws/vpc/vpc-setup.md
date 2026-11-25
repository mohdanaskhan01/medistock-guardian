# Amazon VPC Network Isolation Setup for MediStock Guardian

1. Create a VPC named `medistock-guardian-vpc` with IPv4 CIDR `10.20.0.0/16`.
2. Create two Public Subnets (`10.20.1.0/24`, `10.20.2.0/24`) for the Application Load Balancer / EC2 web tier and attach an Internet Gateway.
3. Create two Private Subnets (`10.20.11.0/24`, `10.20.12.0/24`) for AWS Lambda monitoring functions and internal workloads.
4. Add VPC Gateway Endpoints for **Amazon DynamoDB** and **Amazon S3** so inventory queries and supplier document uploads stay within the AWS private network.
5. Configure Security Groups:
   - `medistock-ec2-sg`: Allow inbound HTTPS (443) and HTTP (80) from your clinic IP range (or ALB), SSH (22) strictly from your admin IP.
   - `medistock-lambda-sg`: No inbound rules; outbound HTTPS (443) to DynamoDB, SNS, and CloudWatch endpoints.
