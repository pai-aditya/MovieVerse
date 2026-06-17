import { FcGoogle } from 'react-icons/fc';
import { Link, useNavigate  } from 'react-router-dom';
import { useState } from 'react';
import { SERVER_URL } from '../components/Constants';
import Spinner from '../components/Spinner';
const Register = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const navigateTo  = useNavigate ();
  

  const googleAuth = () => {
    window.open(
      `${SERVER_URL}/auth/google`,
      "_self"
    );
  };
  
  const handleRegister = async (e) => {
    setLoading(true);
    e.preventDefault();

    try {
      const response = await fetch(`${SERVER_URL}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, displayName,password }),
        credentials: 'include',
      });

      const data = await response.json();

      console.log('Registration response:', data);
      if (data.success) {
        console.log("entering registration success rout from the UI")
        setLoading(false);
        navigateTo(0);
        // navigateTo("/profile");
        
      } else {
        setLoading(false);
        console.error('Registration failed:', data.message);
      }
    } catch (error) {
      setLoading(false);
      console.error('Registration failed:', error.message);
    }
  };
  

  return (
    <div className="relative w-full h-screen bg-custom-primary-purple">
    {loading ? (
      <Spinner />
    ) : (
    
    <div className="h-screen">
      <div className="flex justify-center items-center h-full">
        <form className="max-w-[400px] w-full mx-auto p-8 rounded-lg bg-gray-800 text-white border-4 border-custom-gold" onSubmit={handleRegister}>
          {/* Welcome text */}
          <div className="text-center text-2xl font-bold text-gray-200 mb-4">
            Join Us!
          </div>
          <img
            className="text-4xl font-bold text-center py-4 text-white"
            src="/logo.svg"
          />
          {/* DisplayName Username and password fields */}
          <div className="flex flex-col mb-4">
            <label htmlFor="name" className="text-sm text-gray-200">
              Name
            </label>
            <input
              id="name"
              className="border rounded-lg relative bg-gray-700 p-2 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-white"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="flex flex-col mb-4">
            <label htmlFor="username" className="text-sm text-gray-200">
              Username
            </label>
            <input
              id="username"
              className="border rounded-lg relative bg-gray-700 p-2 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-white"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="flex flex-col">
            <label htmlFor="password" className="text-sm text-gray-200">
              Password
            </label>
            <input
              id="password"
              className="border rounded-lg relative bg-gray-700 p-2 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-white"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {/* <Link to="/profile" > */}
          <button className="w-full py-3 mt-8 hover:bg-indigo-800 bg-indigo-600 relative text-white rounded-lg" type="submit">
            Register
          </button>
          {/* </Link> */}
          {/* Google login button */}
          <div className="flex justify-center py-4">
            <button type="button"  onClick={googleAuth} className="px-6 py-2 relative flex items-center rounded-lg shadow-lg hover:shadow-xl hover:bg-red-900 bg-red-700 text-white">
              Sign in with <FcGoogle className="ml-4 mr-1" size={20} /> Google
            </button>
          </div>
          <div className="flex justify-center py-4">
            <p className="text-gray-400 flex items-center">
              Already a member?
              <Link to="/login">
              <button className="ml-2 px-4 py-2 relative flex items-center rounded-lg shadow-lg hover:shadow-xl hover:bg-indigo-800 bg-indigo-600 text-white">
                Login Now
              </button>
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
    
    )}
    </div>
  );
};

export default Register;
