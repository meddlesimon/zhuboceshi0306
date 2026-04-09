import React, { useCallback, useState } from 'react';
import { UploadCloud, Loader2 } from 'lucide-react';
import * as mammoth from 'mammoth';

interface FileUploaderProps {
  title: string;
  description: string;
  accept?: string;
  onFileLoaded: (content: string, fileName: string) => void;
  icon?: React.ReactNode;
}

const FileUploader: React.FC<FileUploaderProps> = ({ 
  title, 
  description, 
  accept = ".csv,.txt,.docx", 
  onFileLoaded,
  icon
}) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  }, [onFileLoaded]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  };

  const readFile = (file: File) => {
    setIsProcessing(true);
    
    // Handle DOCX files
    if (file.name.toLowerCase().endsWith('.docx')) {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        if (!arrayBuffer) {
          setIsProcessing(false);
          return;
        }
        try {
          const result = await mammoth.extractRawText({ arrayBuffer });
          onFileLoaded(result.value, file.name);
        } catch (err) {
          console.error("DOCX parsing error:", err);
          alert("无法解析 DOCX 文件，请确认文件未损坏。");
        } finally {
          setIsProcessing(false);
        }
      };
      reader.onerror = () => setIsProcessing(false);
      reader.readAsArrayBuffer(file);
      return;
    }

    // Handle Text-based files (CSV, TXT)
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      onFileLoaded(content, file.name);
      setIsProcessing(false);
    };
    reader.onerror = () => setIsProcessing(false);
    reader.readAsText(file);
  };

  return (
    <div 
      className={`border-2 border-dashed border-slate-300 rounded-xl py-12 px-6 text-center transition-colors cursor-pointer bg-white relative ${isProcessing ? 'opacity-50 pointer-events-none' : 'active:bg-blue-50 active:border-blue-400'}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => !isProcessing && document.getElementById('file-upload-' + title)?.click()}
    >
      <input 
        type="file" 
        id={'file-upload-' + title} 
        className="hidden" 
        accept={accept} 
        onChange={handleChange} 
      />
      
      {isProcessing ? (
        <div className="flex flex-col items-center gap-4">
           <Loader2 size={32} className="animate-spin text-blue-600" />
           <p className="text-sm text-slate-500">正在解析文件...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="p-4 bg-slate-100 text-slate-500 rounded-full">
            {icon || <UploadCloud size={32} />}
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-400 mt-1">{description}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUploader;