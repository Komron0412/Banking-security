'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import * as faceapi from 'face-api.js';

export default function FaceVerification() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [livenessScore, setLivenessScore] = useState(0);
  const [message, setMessage] = useState('Starting face verification...');
  const lastPositionsRef = useRef<any[]>([]);
  const blinkCountRef = useRef(0);
  const lastEARRef = useRef<number[]>([]);
  const [debugInfo, setDebugInfo] = useState({ ear: 0, state: 'open', threshold: 0 });

  useEffect(() => {
    const loadModels = async () => {
      try {
        setMessage('Loading face detection models...');
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceExpressionNet.loadFromUri('/models')
        ]);
        setMessage('Models loaded successfully. Starting camera...');
        setIsLoading(false);
        startVideo();
      } catch (error) {
        console.error('Error loading models:', error);
        setMessage('Error loading face detection models. Please refresh the page.');
      }
    };

    loadModels();
    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, []);

  const getEyeAspectRatio = (eye: any[]) => {
    try {
      // Vertical eye landmarks - using multiple points for better accuracy
      const v1 = euclideanDistance(eye[1], eye[5]);
      const v2 = euclideanDistance(eye[2], eye[4]);
      // Horizontal eye landmark
      const h = euclideanDistance(eye[0], eye[3]);
      // Compute the eye aspect ratio with additional weight on vertical distances
      return h > 0 ? ((v1 + v2) / (2.0 * h)) * 1.5 : 0;
    } catch (error) {
      console.error('Error calculating EAR:', error);
      return 0;
    }
  };

  const euclideanDistance = (pt1: any, pt2: any) => {
    return Math.sqrt(Math.pow(pt2.x - pt1.x, 2) + Math.pow(pt2.y - pt1.y, 2));
  };

  const detectBlink = (landmarks: any): number => {
    if (!landmarks) return 0;
    
    try {
      // Get eye landmarks
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();
      
      // Calculate eye aspect ratio
      const leftEAR = getEyeAspectRatio(leftEye);
      const rightEAR = getEyeAspectRatio(rightEye);
      
      // Average eye aspect ratio
      const ear = (leftEAR + rightEAR) / 2.0;
      
      // Keep track of last 10 EAR values
      lastEARRef.current.push(ear);
      if (lastEARRef.current.length > 10) {
        lastEARRef.current.shift();
      }

      // Calculate baseline EAR (average of highest values)
      const sortedEARs = [...lastEARRef.current].sort((a, b) => b - a);
      const baselineEAR = sortedEARs.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
      
      // Dynamic threshold based on baseline
      const threshold = baselineEAR * 0.65; // More sensitive threshold

      // Detect rapid decrease and increase in EAR (blink pattern)
      if (lastEARRef.current.length >= 3) {
        const prev = lastEARRef.current[lastEARRef.current.length - 2];
        const current = ear;
        
        // Update debug info with more details
        setDebugInfo({
          ear: current,
          state: current < threshold ? 'closed' : 'open',
          threshold: threshold
        });

        // Detect significant eye closure
        if (prev > threshold && current < threshold) {
          blinkCountRef.current += 1;
          console.log('Blink detected:', { 
            ear: current, 
            threshold: threshold, 
            baseline: baselineEAR 
          });
        }
      }
      
      return blinkCountRef.current;
    } catch (error) {
      console.error('Error in blink detection:', error);
      return blinkCountRef.current;
    }
  };

  const detectMovement = (landmarks: any) => {
    if (!landmarks) return 0;
    
    const nose = landmarks.getNose()[0];
    const currentPosition = { x: nose.x, y: nose.y };
    
    // Keep last 10 positions
    lastPositionsRef.current.push(currentPosition);
    if (lastPositionsRef.current.length > 10) {
      lastPositionsRef.current.shift();
    }
    
    // Calculate movement variance
    if (lastPositionsRef.current.length < 2) return 0;
    
    let totalMovement = 0;
    for (let i = 1; i < lastPositionsRef.current.length; i++) {
      const prev = lastPositionsRef.current[i - 1];
      const curr = lastPositionsRef.current[i];
      totalMovement += Math.abs(curr.x - prev.x) + Math.abs(curr.y - prev.y);
    }
    
    return totalMovement / lastPositionsRef.current.length;
  };

  const detectEyeState = (currentEAR: number, baselineEAR: number): boolean => {
    // More aggressive threshold for eye closure
    const threshold = baselineEAR * 0.75; // Increased from 0.65 to 0.75
    const isEyeClosed = currentEAR < threshold;
    
    console.log('Eye State Debug:', {
      currentEAR,
      baselineEAR,
      threshold,
      isEyeClosed
    });
    
    return isEyeClosed;
  };

  const startVideo = async () => {
    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          frameRate: { ideal: 30 }
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setMessage('Camera started. Positioning your face in the center of the frame...');
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      setMessage('Error accessing camera. Please ensure camera permissions are granted and no other app is using it.');
    }
  };

  const drawEyes = (ctx: CanvasRenderingContext2D, leftEye: any[], rightEye: any[], isEyeClosed: boolean) => {
    ctx.strokeStyle = isEyeClosed ? 'red' : 'yellow'; // Change color based on state
    ctx.lineWidth = 2;

    if (isEyeClosed) {
      // Draw closed eyes (just horizontal lines)
      [leftEye, rightEye].forEach(eye => {
        const topY = (eye[1].y + eye[2].y) / 2;
        ctx.beginPath();
        ctx.moveTo(eye[0].x, topY);
        ctx.lineTo(eye[3].x, topY);
        ctx.stroke();

        // Add vertical markers to show detection points
        [0, 3].forEach(index => {
          ctx.beginPath();
          ctx.arc(eye[index].x, topY, 2, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    } else {
      // Draw open eyes (full shape)
      [leftEye, rightEye].forEach(eye => {
        ctx.beginPath();
        ctx.moveTo(eye[0].x, eye[0].y);
        eye.forEach((pt: any) => ctx.lineTo(pt.x, pt.y));
        ctx.closePath();
        ctx.stroke();

        // Draw detection points
        eye.forEach((pt: any) => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    }
  };

  const handleVideoPlay = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const intervalId = setInterval(async () => {
        if (video && canvas) {
          try {
            const options = new faceapi.TinyFaceDetectorOptions({
              inputSize: 320,
              scoreThreshold: 0.3
            });

            const detections = await faceapi
              .detectAllFaces(video, options)
              .withFaceLandmarks()
              .withFaceExpressions();

            const displaySize = { width: video.videoWidth, height: video.videoHeight };
            faceapi.matchDimensions(canvas, displaySize);
            
            const resizedDetections = faceapi.resizeResults(detections, displaySize);
            const ctx = canvas.getContext('2d');
            
            if (ctx) {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              
              // Draw guide box
              const boxSize = { width: canvas.width * 0.5, height: canvas.height * 0.6 };
              const boxX = (canvas.width - boxSize.width) / 2;
              const boxY = (canvas.height - boxSize.height) / 2;
              
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
              ctx.lineWidth = 2;
              ctx.setLineDash([5, 5]);
              ctx.strokeRect(boxX, boxY, boxSize.width, boxSize.height);
              ctx.setLineDash([]);

              if (resizedDetections.length > 0) {
                // Draw face detections
                faceapi.draw.drawDetections(canvas, resizedDetections);
                
                // Get landmarks and calculate EAR
                const faceLandmarks = resizedDetections[0].landmarks;
                const leftEye = faceLandmarks.getLeftEye();
                const rightEye = faceLandmarks.getRightEye();
                
                // Calculate current EAR with more weight on vertical distances
                const leftEAR = getEyeAspectRatio(leftEye);
                const rightEAR = getEyeAspectRatio(rightEye);
                const currentEAR = (leftEAR + rightEAR) / 2.0;
                
                // Update last EAR values
                lastEARRef.current.push(currentEAR);
                if (lastEARRef.current.length > 10) {
                  lastEARRef.current.shift();
                }

                // Calculate baseline EAR from the highest values (open eyes)
                const sortedEARs = [...lastEARRef.current].sort((a, b) => b - a);
                const baselineEAR = sortedEARs.slice(0, 3).reduce((a, b) => a + b, 0) / 3;

                // Determine if eyes are closed using the new detection function
                const isEyeClosed = detectEyeState(currentEAR, baselineEAR);

                // Draw eyes based on state
                drawEyes(ctx, leftEye, rightEye, isEyeClosed);

                // Enhanced debug info
                ctx.font = '16px Arial';
                ctx.fillStyle = 'white';
                ctx.fillText(`Face Detected: Yes`, 10, 20);
                ctx.fillText(`EAR: ${currentEAR.toFixed(3)}`, 10, 40);
                ctx.fillText(`Baseline: ${baselineEAR.toFixed(3)}`, 10, 60);
                ctx.fillText(`Threshold: ${(baselineEAR * 0.75).toFixed(3)}`, 10, 80);
                ctx.fillText(`Eye State: ${isEyeClosed ? 'CLOSED' : 'OPEN'}`, 10, 100);
                ctx.fillText(`Blinks: ${blinkCountRef.current}`, 10, 120);

                // Process face for liveness
                const expressions = resizedDetections[0].expressions;
                const blinkCount = detectBlink(faceLandmarks);
                const movement = detectMovement(faceLandmarks);
                const expressionChange = Math.max(
                  expressions.happy,
                  expressions.surprised,
                  expressions.neutral
                );

                const livenessScore = Math.min(
                  ((blinkCount as number) * 0.3) +
                  ((movement as number) * 2) +
                  (expressionChange * 0.3),
                  1
                );
                
                setLivenessScore(livenessScore);
                
                if (livenessScore > 0.7) {
                  if (blinkCount < 2) {
                    setMessage(`Please blink naturally (${blinkCount}/2 blinks)`);
                  } else if (movement < 0.1) {
                    setMessage('Please move your head slightly');
                  } else {
                    setMessage('Live face verified! Natural movements detected.');
                  }
                } else {
                  setMessage('Position your face in the box and blink naturally');
                }
              } else {
                ctx.font = '16px Arial';
                ctx.fillStyle = 'white';
                ctx.fillText('No face detected', 10, 20);
                ctx.fillText('Please position your face in the box', 10, 40);
                setMessage('No face detected. Please position your face in the center box.');
              }
            }
          } catch (error) {
            console.error('Error in face detection:', error);
            setMessage('Face detection error. Please ensure good lighting and face the camera.');
          }
        }
      }, 100);

      return () => clearInterval(intervalId);
    }
  };

  return (
    <div className="relative w-full max-w-md mx-auto p-4">
      <div className="relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onPlay={handleVideoPlay}
          className="w-full rounded-lg shadow-lg"
          style={{ transform: 'scaleX(-1)' }} // Mirror the video
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full"
          style={{ transform: 'scaleX(-1)' }} // Mirror the canvas to match video
        />
      </div>
      
      <div className="mt-4 p-4 bg-white rounded-lg shadow">
        <p className="text-lg font-semibold text-gray-800">{message}</p>
        <div className="mt-2">
          <p className="text-sm text-gray-600">Liveness Score: {(livenessScore * 100).toFixed(1)}%</p>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className="bg-blue-600 h-2.5 rounded-full"
              style={{ width: `${livenessScore * 100}%` }}
            ></div>
          </div>
        </div>
      </div>
      
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-lg">
          <div className="text-white text-lg">Loading face detection models...</div>
        </div>
      )}
    </div>
  );
} 