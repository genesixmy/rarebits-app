import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Mail, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext.jsx';
import { useToast } from '@/components/ui/use-toast';

const LoginPage = () => {
  const { signIn } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn({ email, password });
    setLoading(false);
    if (error) {
      toast({
        title: "Log Masuk Gagal",
        description: "Sila periksa e-mel dan kata laluan anda.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Log Masuk Berjaya!",
        description: "Selamat datang kembali!",
      });
      navigate('/');
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-background p-4">
      <motion.div
        className="w-full max-w-md mx-auto"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="rounded-xl shadow-lg overflow-hidden bg-card border">
          <div className="p-8 sm:p-12 flex flex-col justify-center">
            <div className="text-center mb-8 flex flex-col items-center">
                <h1 className="text-4xl font-bold gradient-text">RAREBITS</h1>
                <p className="text-muted-foreground mt-1">Sistem Pengurusan Jualan</p>
            </div>
            <h3 className="text-2xl font-bold text-foreground text-center">Log Masuk</h3>
            <p className="text-muted-foreground mt-2 text-center">Selamat datang kembali! Sila masukkan butiran anda.</p>
            
            <form onSubmit={handleLogin} className="mt-8 space-y-6">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input 
                  type="email" 
                  placeholder="E-mel" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  required 
                  className="pl-10 h-12 bg-secondary"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input 
                  type="password" 
                  placeholder="Kata Laluan" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  required 
                  className="pl-10 h-12 bg-secondary"
                />
              </div>
              <Button type="submit" className="w-full text-white text-base font-semibold py-6 brand-gradient brand-gradient-hover" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : 'Log Masuk'}
              </Button>
            </form>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;