import { useState } from 'react';
import BackButton from '../components/BackButton';
import Spinner from '../components/Spinner';
import {useNavigate } from 'react-router-dom';
import { SERVER_URL } from '../components/Constants';
import TitleCard from '../components/TitleCard';
const ListCreate = (userDetails) => {
  const [listDescription, setListDescription] = useState('');
  const [listName,setListName] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigateTo = useNavigate();




  const handleSaveList = async (e) => {
    setLoading(true);
    e.preventDefault();

    try {
        const response = await fetch(`${SERVER_URL}/lists/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ listName,listDescription }),
          credentials: 'include',
        });
  
        const data = await response.json();
  
        console.log('List creation response:', data);
        if (data.success) {
          setLoading(false);
          navigateTo("/yourlists");
          
        } else {
          setLoading(false);
          console.error('List creation failed:', data.message);
        }
      } catch (error) {
        setLoading(false);
        console.error('List creation failed:', error.message);
      }
  };

  return (
    <div className='p-4  w-full bg-custom-primary-purple text-white'>
      <BackButton />
      {loading ? (
        <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <Spinner />
        </div>
       ) : (
        <div className='my-4 flex flex-col border-2 border-sky-400 rounded-xl w-1/2 bg-gray-800 p-4 mx-auto'>
        <div className='flex items-center justify-center my-4 mr-4 '>
          <TitleCard />
        </div>
        <h1 className='text-3xl my-4 text-center font-bold text-gray-200'>Create your List!</h1>
        <div className='my-4'>
          <label className='text-xl mr-4 text-gray-400'>List created by</label>
          <p>{userDetails.user.user.displayName}</p>
        </div>
        <div className='my-4'>
          <label className='text-xl mr-4 text-gray-400'>List name</label>
          <textarea
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            className='border-2 border-gray-400 px-4 py-2 w-full bg-gray-700'
            rows={1}
          />
        </div>
        <div className='my-4'>
          <label className='text-xl mr-4 text-gray-400'>List Description</label>
          <textarea
            value={listDescription}
            onChange={(e) => setListDescription(e.target.value)}
            className='border-2 border-gray-400 px-4 py-2 w-full bg-gray-700'
            rows={3}
          />
        </div>
        <button className='p-2 font-bold bg-blue-500 hover:bg-blue-900 m-8 disabled:bg-gray-500 disabled:text-gray-300 ' 
          onClick={handleSaveList} 
          disabled={!listName || !listDescription}>
          Save List
        </button>
      </div>
    
      )}
      </div>
      
  );
};

export default ListCreate;
