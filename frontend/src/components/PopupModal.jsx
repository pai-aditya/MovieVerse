import { useState } from 'react';
import { AiOutlineClose } from 'react-icons/ai';
import { SERVER_URL } from './Constants';
import { useNavigate } from 'react-router-dom';
const PopupModal = ({ title, contentMessage, buttonMessage, id, onClose }) => {

    const navigateTo = useNavigate();
    const [, setLoading] = useState(false);

    const handleDeleteReview = async () => {
        setLoading(true);
        // e.preventDefault();

        try {
            const response = await fetch(`${SERVER_URL}/review/delete/${id}`, {
                method: 'DELETE',
                headers: {
                'Content-Type': 'application/json',
                },
                credentials: 'include',
        });

        const data = await response.json();

        console.log('Deletion response:', data);
        if (data.success) {
            setLoading(false);
            onClose();
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

    
  const handleDeleteCard = async () => {
    setLoading(true);

    try {
      const response = await fetch(`${SERVER_URL}/lists/deleteList/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });

      const data = await response.json();

      console.log('Login response:', data);
      if (data.success) {
        setLoading(false);
        navigateTo(0);
      } else {
        setLoading(false);
        console.error('Registration failed:', data.message);
      }
    } catch (error) {
      setLoading(false);
      console.error('Registration failed:', error.message);
    }
  };
  

    const handleDelete = async (e) => {
        e.preventDefault();
        console.log("entering12");
        if(title=="Delete Review"){
            console.log("entering34");
            await handleDeleteReview();
        }else if(title=="Delete Card"){
            await handleDeleteCard();
        }
    }
  
    return (
        <div className='fixed bg-black bg-opacity-50 inset-0 z-50 flex items-center justify-center'>
        <div onClick={onClose} className='absolute inset-0 bg-black opacity-25'></div>
        <div className='relative bg-gray-900 rounded-lg shadow-lg max-w-lg w-full p-6 text-center'>
            <button onClick={onClose} className='absolute top-3 right-3 text-gray-400 hover:text-gray-700 focus:outline-none'>
            <AiOutlineClose className='text-xl' />
            </button>
            <h2 className='text-2xl font-semibold mb-4'>{title}</h2>
            <p className='text-gray-400 mb-6'>{contentMessage}</p>
            <div className='flex justify-center'>
            <button
                onClick={handleDelete}
                className='bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-6 rounded focus:outline-none focus:shadow-outline'
            >
                {buttonMessage}
            </button>
            </div>
        </div>
        </div>
    );
};

export default PopupModal;
